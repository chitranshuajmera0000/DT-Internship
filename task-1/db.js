import mongoDb from "mongodb";
import dotenv from "dotenv";

const { MongoClient } = mongoDb;
dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function connectToDatabase() {
    try {
        await client.connect();
        console.log("Connected to MongoDB");
        return client.db("DTInternship");

    } catch (err) {
        console.error("Error connecting to MongoDB:", err);
        throw err;
    }
}

export { connectToDatabase };