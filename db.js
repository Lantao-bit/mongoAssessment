//Using Mongo DB - import individual variables instead of entire package (deconstructoring)
const { MongoClient, ServerApiVersion } = require('mongodb');

// global client (used a singleton)
let client = null;  // store a client to the database

async function connect(uri, dbname) {
    // singleton pattern to ensure that the client is only created once
    if (client) {
        return client;
    }
    // if the client is null, create one
    client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1
        }
    });

    // connect to the cluster using the client
    try {
        await client.connect();
        console.log("Successfully connected to Mongo")

        // return a connection to the database
        return client.db(dbname);

    } catch (error) {
        console.error('Error connecting to MongoDB', error);
    }
}

// make the connect function available for other JavaScript files e.g. index.js
module.exports = {
    connect
}