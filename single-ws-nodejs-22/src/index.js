const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });
const { TABLE_NAME } = process.env;
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  const routeKey = event.requestContext.routeKey;
  console.log(`Route Key: ${routeKey}`);
  if (routeKey === '$connect') {
    return handleConnect(event);
  } else if (routeKey === '$disconnect') {
    return handleDisconnect(event);
  } else if (routeKey === 'post') {
    return handlePost(event);
  } else {
    console.log('Invalid route key:', routeKey);
    return { statusCode: 400, body: 'Invalid route key' };
  }
};
const handleConnect = async (event) => {
  console.log('Handling $connect...');
  const connectionId = event.requestContext.connectionId;
  console.log(`Connection ID: ${connectionId}`);
  const putParams = {
    TableName: TABLE_NAME,
    Item: {
      connectionId: connectionId,
      ttl: parseInt((Date.now() / 1000) + 3600), // TTL for 1 hour
    },
  };
  console.log('DynamoDB putParams:', JSON.stringify(putParams, null, 2));
  try {
    await ddb.put(putParams).promise();
    console.log('Successfully connected and stored connectionId.');
    return { statusCode: 200, body: 'Connected.' };
  } catch (err) {
    console.error('Error storing connectionId:', err);
    return { statusCode: 500, body: 'Failed to connect: ' + JSON.stringify(err) };
  }
};
const handleDisconnect = async (event) => {
  console.log('Handling $disconnect...');
  const connectionId = event.requestContext.connectionId;
  console.log(`Connection ID: ${connectionId}`);
  const deleteParams = {
    TableName: TABLE_NAME,
    Key: {
      connectionId: connectionId,
    },
  };
  console.log('DynamoDB deleteParams:', JSON.stringify(deleteParams, null, 2));
  try {
    await ddb.delete(deleteParams).promise();
    console.log('Successfully disconnected and removed connectionId.');
    return { statusCode: 200, body: 'Disconnected.' };
  } catch (err) {
    console.error('Error deleting connectionId:', err);
    return { statusCode: 500, body: 'Failed to disconnect: ' + JSON.stringify(err) };
  }
};
const handlePost = async (event) => {
  console.log('Handling post...');
  let connectionData;
  try {
    console.log('Fetching all connection IDs from DynamoDB...');
    connectionData = await ddb
      .scan({ TableName: TABLE_NAME, ProjectionExpression: 'connectionId' })
      .promise();
    console.log('Fetched connection IDs:', JSON.stringify(connectionData.Items, null, 2));
  } catch (e) {
    console.error('Error fetching connection IDs:', e);
    return { statusCode: 500, body: e.stack };
  }
  const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: event.requestContext.domainName + '/' + event.requestContext.stage,
  });
  console.log('ApiGatewayManagementApi endpoint:', apigwManagementApi.endpoint);
  const postData = JSON.parse(event.body).data;
  console.log('Post data:', postData);
  const postCalls = connectionData.Items.map(async ({ connectionId }) => {
    try {
      console.log(`Sending data to connection ID: ${connectionId}`);
      await apigwManagementApi
        .postToConnection({ ConnectionId: connectionId, Data: postData })
        .promise();
      console.log(`Successfully sent data to connection ID: ${connectionId}`);
    } catch (e) {
      if (e.statusCode === 410) {
        console.log(`Found stale connection, deleting connection ID: ${connectionId}`);
        await ddb.delete({ TableName: TABLE_NAME, Key: { connectionId } }).promise();
      } else {
        console.error(`Error posting to connection ID: ${connectionId}`, e);
      }
    }
  });
  try {
    console.log('Executing all post calls...');
    await Promise.all(postCalls);
    console.log('All data sent successfully.');
    return { statusCode: 200, body: 'Data sent.' };
  } catch (e) {
    console.error('Error during broadcast:', e);
    return { statusCode: 500, body: e.stack };
  }
};






