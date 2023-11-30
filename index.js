const express = require('express')
const app = express()
const cors = require('cors')
var jwt = require('jsonwebtoken');
require('dotenv').config()
const { ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;



// middleware 
app.use(cors());
app.use(express.json())



const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.2rm9pnz.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const userCollection = client.db("shareRankDb").collection("users");
        const postCollection = client.db("shareRankDb").collection("posts");
        const commentCollection = client.db("shareRankDb").collection("comments");
        const feedbackCollection = client.db("shareRankDb").collection("feedbacks");
        const announcementCollection = client.db("shareRankDb").collection("announcements");
        const tagCollection = client.db("shareRankDb").collection("tags");



        // jwt related API

        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '1h'
            })
            res.send({ token })
        })



        //middleWare
        const verifyToken = (req, res, next) => {
            // console.log('Inside verify token:', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: ' unauthorized access' })
                }
                req.decoded = decoded;
                next()
            })
        }



        //use verifyAdmin after VerifyToken

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }



        // user related API 

        app.get('/users', verifyToken, async (req, res) => {
            const search = req.query.search;

            const query = {};
            if (search) {
                query.name = { $regex: new RegExp(search, "i") };
            }

            const result = await userCollection
                .aggregate([
                    { $match: query }
                ])
                .toArray();
            res.send(result);

        })


        app.get('/user/currentUser', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await userCollection.find(query).toArray();
            res.send(result);

        });


        app.get('/user/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = { email: email }
            const user = await userCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin })
        })


        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result)
        })


        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })





        // post related apis 
        app.get('/allPosts', async (req, res) => {
            try {
                const result = await postCollection.find().toArray();
                console.log(result); 
                res.send(result);
            } catch (error) {
                console.error("Error fetching posts:", error);
                res.status(500).send("Error fetching posts");
            }
        });


        app.get("/posts", async (req, res) => {
            try {
                const search = req.query.search;
                const page = req.query.page ? parseInt(req.query.page) : 1;
                const limit = 5;
                const skip = (page - 1) * limit;

                const query = {};

                if (search) {
                    query.tag = { $regex: new RegExp(search, "i") };
                }

                let sortItem = { postTime: -1 };

                if (req.query.vote === 'upVote') {
                    sortItem = { voteDifference: -1 };
                }

                const result = await postCollection
                    .aggregate([
                        { $match: query },
                        {
                            $addFields: {
                                voteDifference: { $subtract: ["$upVote", "$downVote"] }
                            }
                        },
                        { $sort: sortItem },
                        { $skip: skip },
                        { $limit: limit }
                    ])
                    .toArray();

                res.send(result);
            } catch (error) {
                console.error("Error fetching allSort post:", error);
                res.status(500).send({ error: "Internal Server Error" });
            }
        });


        app.get('/post/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await postCollection.findOne(query);
            res.send(result)
        })



        app.get('/addPost/user', async (req, res) => {
            const email = req.query.email;
            const query = { authorEmail: email };
            let sortItem = { postTime: -1 };
            const result = await postCollection.find(query).sort(sortItem).toArray();
            res.send(result)
        })



        app.patch('/post/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updateVote = req.body;
            const product = {
                $set: {
                    upVote: updateVote.newUpVote,
                    downVote: updateVote.newDownVote,

                }
            }
            const result = await postCollection.updateOne(filter, product, options)
            res.send(result)
        })


        app.delete('/post/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await postCollection.deleteOne(query);
            res.send(result);
        })



        app.post('/addPost', verifyToken, async (req, res) => {
            const item = req.body;
            const result = await postCollection.insertOne(item);
            res.send(result)
        })




        // comment related api 

        app.get('/comment', verifyToken, async (req, res) => {
            const result = await commentCollection.find().toArray();
            res.send(result)
        })



        app.delete('/comment/:id',verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await commentCollection.deleteOne(query);
            res.send(result);
        })



        app.post('/comment', verifyToken, async (req, res) => {
            const item = req.body;
            const result = await commentCollection.insertOne(item);
            res.send(result)
        })



        // feedback related api 

        app.get('/feedback', verifyToken, async (req, res) => {
            const result = await feedbackCollection.find().toArray();
            res.send(result)
        })


        app.delete('/feedback/:id',verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await feedbackCollection.deleteOne(query);
            res.send(result);
        })



        app.post('/feedback', verifyToken, async (req, res) => {
            const item = req.body;
            const result = await feedbackCollection.insertOne(item);
            res.send(result)
        })



        // announcement related api 



        app.get('/announcement',  async (req, res) => {
            const result = await announcementCollection.find().toArray();
            res.send(result)
        })


        app.post('/announcement', verifyToken, async (req, res) => {
            const item = req.body;
            const result = await announcementCollection.insertOne(item);
            res.send(result)
        })



        // tag related Api 
        app.get('/tag', async (req, res) => {
            const result = await tagCollection.find().toArray();
            res.send(result)
        })


        app.post('/tag', verifyToken, async (req, res) => {
            const item = req.body;
            const result = await tagCollection.insertOne(item);
            res.send(result)
        })





        // payment intent

        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: [
                    "card"
                ],
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })


        app.patch('/users/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    badge: 'gold'
                }
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result)
        })


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Share Rank is running')
})

app.listen(port, () => {
    console.log(`Share Rank is running on port ${port}`)
})