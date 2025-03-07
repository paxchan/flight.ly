require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const { check, validationResult } = require('express-validator');
const app = express();
const path = require('path');

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());
app.use(express.json());

// MySQL connection setup using environment variables
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
});

// Connect to MySQL
db.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
    } else {
        console.log('Connected to MySQL successfully');
    }
});

// Endpoint to test database connection
app.get('/api/test-connection', (req, res) => {
    db.ping((err) => {
        if (err) {
            console.error('MySQL Connection Failed:', err);
            res.status(500).send('Database connection failed.');
        } else {
            res.send('Database connection successful.');
        }
    });
});

// Endpoint to get all cities for dropdown
app.get('/api/cities', (req, res) => {
    const query = 'SELECT DISTINCT city FROM Airports';
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching cities:', err);
            res.status(500).send('An error occurred while fetching cities from the database.');
        } else {
            const cities = results.map(row => ({ name: row.city }));
            res.json(cities);
        }
    });
});

// Endpoint to get flights based on user query
app.post('/api/flights', [
    check('departureDate').isISO8601(),
    check('departureCity').notEmpty(),
    check('arrivalCity').notEmpty()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { departureDate, departureCity, arrivalCity } = req.body;

    const query = `
        SELECT 
            Flights.flight_id, 
            Airlines.airline_name AS airline,
            Flights.departure_datetime, 
            Flights.arrival_datetime, 
            Flights.flight_duration,
            Flights.layover_count,
            Flights.total_flight_duration,
            Flights.cost,
            DepAirport.city AS departure_city,
            ArrAirport.city AS arrival_city,
            Layover1.city AS layover1_city,
            Flights.layover1_airport_id,
            Flights.layover1_duration,
            Flights.layover1_departure_datetime,
            Flights.layover1_flight_duration,
            Layover2.city AS layover2_city,
            Flights.layover2_airport_id,
            Flights.layover2_duration,
            Flights.layover2_departure_datetime,
            Flights.layover2_flight_duration,
            Layover3.city AS layover3_city,
            Flights.layover3_airport_id,
            Flights.layover3_duration,
            Flights.layover3_departure_datetime,
            Flights.layover3_flight_duration
        FROM 
            Flights
        JOIN 
            Airports AS DepAirport ON Flights.departure_airport_id = DepAirport.airport_id
        JOIN 
            Airports AS ArrAirport ON Flights.arrival_airport_id = ArrAirport.airport_id
        LEFT JOIN 
            Airports AS Layover1 ON Flights.layover1_airport_id = Layover1.airport_id
        LEFT JOIN 
            Airports AS Layover2 ON Flights.layover2_airport_id = Layover2.airport_id
        LEFT JOIN 
            Airports AS Layover3 ON Flights.layover3_airport_id = Layover3.airport_id
        JOIN 
            Airlines ON Flights.airline_id = Airlines.airline_id
        WHERE 
            DepAirport.city = ? 
            AND ArrAirport.city = ?
            AND DATE(Flights.departure_datetime) = ?
    `;

    db.query(query, [departureCity, arrivalCity, departureDate], (err, results) => {
        // ... (error handling)

        const formattedResults = results.map(flight => ({
            flightId: flight.flight_id,
            airline: flight.airline,
            departureDatetime: flight.departure_datetime,
            arrivalDatetime: flight.arrival_datetime,
            flightDuration: flight.flight_duration,
            layoverCount: flight.layover_count,
            totalFlightDuration: flight.total_flight_duration,
            cost: flight.cost,
            departureCity: flight.departure_city,
            arrivalCity: flight.arrival_city,
            layovers: [
                flight.layover1_airport_id ? {
                    city: flight.layover1_city,
                    duration: flight.layover1_duration,
                    departureDatetime: flight.layover1_departure_datetime,
                    flightDuration: flight.layover1_flight_duration
                } : null,
                flight.layover2_airport_id ? {
                    city: flight.layover2_city,
                    duration: flight.layover2_duration,
                    departureDatetime: flight.layover2_departure_datetime,
                    flightDuration: flight.layover2_flight_duration
                } : null,
                flight.layover3_airport_id ? {
                    city: flight.layover3_city,
                    duration: flight.layover3_duration,
                    departureDatetime: flight.layover3_departure_datetime,
                    flightDuration: flight.layover3_flight_duration
                } : null
            ].filter(layover => layover !== null)
        }));

        res.json(formattedResults);
    });
});

// Serve flights.ejs for the root URL
app.get('/', async (req, res) => {
    try {
        const citiesResponse = await new Promise((resolve, reject) => {
            db.query('SELECT DISTINCT city FROM Airports', (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        const cities = citiesResponse.map(row => row.city);
        res.render('flights', { cities: cities });
    } catch (error) {
        console.error('Error fetching cities:', error);
        res.status(500).send('An error occurred while fetching cities.');
    }
});

// Start server
const PORT = process.env.PORT || 4000;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

