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

/**
 * Interface lambda to remove a state machine. Removal occurs before the next state change.
 * 
 * @param {Object} event - API Gateway Lambda Proxy Input object.
 * @param {Object} context - Lambda context object.
 * @returns {Object} object - API Gateway Lambda Proxy Output object
 */
exports.handler = async (event, context) => {

    try {
        // Prepare the query.
        const params = {
            TableName: process.env.TABLE_NAME,
        };

        // Get the records from DDB.
        let items = [];
        while (true) {
            const records = await documentClient.scan(params).promise();
            items = [...items, ...records.Items];

            if (records.LastEvaluatedKey === undefined) {
                break;
            }

            params.ExclusiveStartKey = records.LastEvaluatedKey;
        }

        // Return the records.
        const response = {
            statusCode: 200,
            body: JSON.stringify(items),
        };
        return response;

    } catch (error) {
        console.log(error);

        // Return 500.
        const response = {
            statusCode: 500,
            body: JSON.stringify(error)
        };
        return response;
    }

};
