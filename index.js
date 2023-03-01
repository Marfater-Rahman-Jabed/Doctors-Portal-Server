const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { query } = require('express');
const nodemailer = require('nodemailer');
require('dotenv').config()
const app = express();
const port = process.env.PORT || 5000;

const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
// console.log(process.env.PAYMENT_SECRET_KEY)

app.use(cors());
app.use(express.json());




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4jznvny.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri);
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function sendBookingEmail(booking) {
    let transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
            user: "apikey",
            pass: process.env.SENDGRID_API_KEY
        }
    })

}

function verifyJWT(req, res, next) {

    const AuthHeader = req.headers.authorization;
    if (!AuthHeader) {
        return res.status(403).send('unAuthorized Access');
    }

    const token = AuthHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (error, decoded) {
        if (error) {
            return res.status(403).send({ message: 'forbidden' });
        }
        req.decoded = decoded;
        next()

    })


}

async function run() {
    try {

        const appointmentOptionCollection = client.db('DoctorsPortal').collection('AppointmentService');
        const bookingCollection = client.db('DoctorsPortal').collection('BookingsCollection');
        const usersCollection = client.db('DoctorsPortal').collection('usersCollection');
        const doctorsCollection = client.db('DoctorsPortal').collection('doctorsCollection');
        const PaymentCollection = client.db('DoctorsPortal').collection('paymentCollection');


        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            // const email = req.query.email;
            const query = {
                email: decodedEmail,
            }

            const user = await usersCollection.findOne(query)

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden' })
            }
            next();

        }

        app.get('/appointment', async (req, res) => {
            const date = req.query.date;
            console.log(date);
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();
            const optionQuery = { appointmentDate: date };
            const alreadyBooked = await bookingCollection.find(optionQuery).toArray();
            // console.log(alreadyBooked)
            options.map(option => {
                const bookedOption = alreadyBooked.filter(book => book.treatment === option.name)
                // console.log(booked)
                const bookedSlot = bookedOption.map(book => book.slot);
                const remainnigSlot = option.slots.filter(book => !bookedSlot.includes(book))
                option.slots = remainnigSlot;
                // console.log(option.name, remainnigSlot.length)
            })
            res.send(options)
        });

        app.get('/appointmentSelect', async (req, res) => {
            const query = {};
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        })

        app.get('/booking', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const query = {
                email: email
            }
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(401).send({ message: 'unAuthorized' })
            }
            const bookingList = await bookingCollection.find(query).toArray();
            res.send(bookingList)


        });

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            console.log(booking)
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }
            const alreadybooked = await bookingCollection.find(query).toArray();
            if (alreadybooked.length) {
                const message = 'already exist your booking'
                return res.send({ message, acknowledged: false })
            }

            const result = await bookingCollection.insertOne(booking);
            //send an email to the client for confirm her/his booking
            sendBookingEmail(booking)
            res.send(result);
        });

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const result = await bookingCollection.findOne(filter);
            res.send(result);
        });
        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create(
                {
                    amount: amount,
                    currency: 'usd',
                    "payment_method_types": [
                        "card"
                    ],

                }
            );
            res.send({
                clientSecret: paymentIntent.client_secret,
            });

        });

        app.post('/payment', async (req, res) => {
            const payment = req.body;
            const result = await PaymentCollection.insertOne(payment);
            const bookingId = payment.bookingId;
            const filter = { _id: ObjectId(bookingId) };
            updateDoc = {
                $set: {
                    paid: true
                }
            }

            const UpdateBooking = await bookingCollection.updateOne(filter, updateDoc)
            res.send(result);
        })


        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = {
                email: email
            };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: '' })

        })

        app.post('/user', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/user', async (req, res) => {
            const query = {};
            const result = await usersCollection.find(query).toArray();
            res.send(result);
        });

        app.delete('/user/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const result = await usersCollection.deleteOne(filter);
            res.send(result);

        })


        app.get('/user/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })

        app.put('/user/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        });

        // temporary API for updating price in database

        // app.get('/addprice', async (req, res) => {
        //     const filter = {};
        //     const option = { upsert: true };
        //     const updateDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updateDoc, option);
        //     res.send(result);
        // })

        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const result = await doctorsCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });
        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })



    }
    finally {

    }

}
run().catch(console.log())




app.get('/', (req, res) => {
    res.send('Doctor-portal server is running');
})

app.listen(port, () => {
    console.log(`doctor portal is running on port ${port}`)
})

