/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const AWS = require("aws-sdk");

const documentClient = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

/**
 * This lambda implements state changes for the state machine.
 * 
 * @param {Object} event - SQS trigger input object.
 * @param {Object} context - Lambda context object.
 */
exports.handler = async records => {

    const body = JSON.parse(records.Records[0].body);

    try {
        if (body.flag === 'FLAGGED') {
            // Delete the record from DDB.
            const params = {
                TableName: process.env.TABLE_NAME,
                Key: {
                    id: body.id
                }
            };
            await documentClient.delete(params).promise();

        } else {
            // Get the record from DDB.
            const params = {
                TableName: process.env.TABLE_NAME,
                KeyConditionExpression: "#id = :id",
                ExpressionAttributeNames: {
                    "#id": "id"
                },
                ExpressionAttributeValues: {
                    ":id": body.id
                }
            };
            const records = await documentClient.query(params).promise();

            // Act only if a record exists.
            if (records.Count > 0) {

                const record = records.Items[0];
                const id = record.id;
                const config = record.config;
                const object = record.object;
                const state = record.state;

                // Do atomic update of the status.It will fail if the condition is not met.
                await safeUpdate(id, state, id);

                // Invoke the lamda corresponsing to current state synchronously.
                const result = await lambda.invoke({
                    FunctionName: config[state],
                    Payload: JSON.stringify(record)
                }).promise();

                const data = JSON.parse(result.Payload);

                if (data !== null) {
                    // Update the record.
                    try {
                        const item = {
                            id: id,
                            config: config,
                            object: data.object !== undefined ? data.object : object,
                            state: data.state
                        };
                        await documentClient.put({
                            TableName: process.env.TABLE_NAME,
                            Item: item,
                            ConditionExpression: 'attribute_not_exists(removing)'
                        }).promise();

                        const delay = data.delay !== undefined ? data.delay : 0;
                        if (delay >= 0) {
                            await sqs.sendMessage({
                                MessageBody: JSON.stringify(record),
                                QueueUrl: process.env.QUEUE_URL,
                                DelaySeconds: delay
                            }).promise();
                        }

                    } catch (e) {
                        console.log(e);

                        // Delete the record.
                        await documentClient.delete({
                            TableName: process.env.TABLE_NAME,
                            Key: {
                                id: id
                            }
                        }).promise();
                    }

                } else {
                    // Delete the record.
                    await documentClient.delete({
                        TableName: process.env.TABLE_NAME,
                        Key: {
                            id: id
                        }
                    }).promise();
                }
            }
        }

    } catch (error) {
        console.log(error);

        // Update the record.
        await documentClient.put({
            TableName: process.env.TABLE_NAME,
            Item: {
                id: body.id,
                config: config,
                object: object,
                state: 'ERROR',
                errorMessage: error.message
            }
        }).promise();
    }
};

/**
 * Execute an atomic update on the DynamoDB record.
 * 
 * @param {*} id of the state machine.
 * @param {*} stateOld Old state to be ensured while doing the atomic update.
 * @param {*} stateNew New state for the record.
 */
async function safeUpdate(id, stateOld, stateNew) {

    const params = {
        TableName: process.env.TABLE_NAME,
        Key: {
            id: id
        },
        UpdateExpression: 'set #state = :stateNew',
        ConditionExpression: '#state = :stateOld',
        ExpressionAttributeNames: {
            '#state': 'state'
        },
        ExpressionAttributeValues: {
            ':stateOld': stateOld,
            ':stateNew': stateNew
        }
    };

    return documentClient.update(params).promise();
}
