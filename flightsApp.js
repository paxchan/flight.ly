require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const { check, validationResult } = require("express-validator");
const app = express();
const path = require("path");

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  connectionLimit: 10, // Allow up to 10 connections
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

// Test database connection
db.getConnection((err, connection) => {
  if (err) {
    console.error("Error connecting to MySQL:", err);
  } else {
    console.log("Connected to MySQL successfully");
    connection.release(); // Release connection back to the pool
  }
});

// Endpoint to test database connection
app.get("/api/test-connection", (req, res) => {
  db.ping((err) => {
    if (err) {
      console.error("MySQL Connection Failed:", err);
      res.status(500).send("Database connection failed.");
    } else {
      res.send("Database connection successful.");
    }
  });
});

app.get("/api/maps-key", (req, res) => {
  res.json({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.get("/checkout", (req, res) => {
  res.render("checkout");
});

// Endpoint to get all cities for dropdown
app.get("/api/cities", (req, res) => {
  const query = "SELECT DISTINCT city FROM Airports";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching cities:", err);
      res
        .status(500)
        .send("An error occurred while fetching cities from the database.");
    } else {
      const cities = results.map((row) => ({ name: row.city }));
      res.json(cities);
    }
  });
});

// Endpoint to get flights based on user query
app.post(
  "/api/flights",
  [
    check("departureDate").isISO8601(),
    check("departureCity").notEmpty(),
    check("arrivalCity").notEmpty(),
  ],
  (req, res) => {
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

    db.query(
      query,
      [departureCity, arrivalCity, departureDate],
      (err, results) => {
        // ... (error handling)

        const formattedResults = results.map((flight) => ({
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
            flight.layover1_airport_id
              ? {
                  city: flight.layover1_city,
                  duration: flight.layover1_duration,
                  departureDatetime: flight.layover1_departure_datetime,
                  flightDuration: flight.layover1_flight_duration,
                }
              : null,
            flight.layover2_airport_id
              ? {
                  city: flight.layover2_city,
                  duration: flight.layover2_duration,
                  departureDatetime: flight.layover2_departure_datetime,
                  flightDuration: flight.layover2_flight_duration,
                }
              : null,
            flight.layover3_airport_id
              ? {
                  city: flight.layover3_city,
                  duration: flight.layover3_duration,
                  departureDatetime: flight.layover3_departure_datetime,
                  flightDuration: flight.layover3_flight_duration,
                }
              : null,
          ].filter((layover) => layover !== null),
        }));

        res.json(formattedResults);
      }
    );
  }
);

// Serve flights.ejs for the root URL
app.get("/flights", async (req, res) => {
  try {
    const citiesResponse = await new Promise((resolve, reject) => {
      db.query("SELECT DISTINCT city FROM Airports", (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    const cities = citiesResponse.map((row) => row.city);
    res.render("flights", { cities: cities });
  } catch (error) {
    console.error("Error fetching cities:", error);
    res.status(500).send("An error occurred while fetching cities.");
  }
});

app.get("/results", (req, res) => {
  let cart = JSON.parse(req.query.cart || "[]");
  let totalCost = cart.reduce((sum, flight) => sum + (flight.cost || 0), 0); // Ensure cost is always a number
  let points = 0;
  let criteria = [];

  function addCriterion(name, requirement, achieved, score) {
    let finalScore = Math.max(0, Math.min(10, score)); // Ensure scores stay between 0 and 10
    criteria.push({
      name,
      requirement,
      achieved,
      points: isNaN(finalScore) ? 0 : finalScore,
    });
    points += isNaN(finalScore) ? 0 : finalScore;
  }

  let hasSLCDeparture = cart.some((f) => f.departureCity === "Salt Lake City");
  addCriterion(
    "Departed from SLC",
    "Must depart from SLC",
    hasSLCDeparture,
    hasSLCDeparture ? 10 : 0
  );

  let hasDCAArrival = cart.some((f) => f.arrivalCity === "Washington D.C.");
  addCriterion(
    "Arrived in DC",
    "Must arrive in Washington D.C.",
    hasDCAArrival,
    hasDCAArrival ? 10 : 0
  );

  let hasDCADeparture = cart.some((f) => f.departureCity === "Washington D.C.");
  addCriterion(
    "Departed from DC",
    "Must depart from Washington D.C.",
    hasDCADeparture,
    hasDCADeparture ? 10 : 0
  );

  let hasSLCArrival = cart.some((f) => f.arrivalCity === "Salt Lake City");
  addCriterion(
    "Arrived in SLC",
    "Must arrive in Salt Lake City",
    hasSLCArrival,
    hasSLCArrival ? 10 : 0
  );

  // Budget Calculation
  let budgetThreshold = 1000;
  let budgetPenalty = Math.floor((totalCost - budgetThreshold) / 10);
  addCriterion(
    "Stayed under budget",
    "$1000 limit",
    totalCost <= budgetThreshold,
    10 - Math.max(0, budgetPenalty)
  );

  // Arrival Time in DC
  let washingtonArrival = cart.find((f) => f.arrivalCity === "Washington D.C.");
  if (washingtonArrival) {
    let arrivalDate = new Date(washingtonArrival.arrivalDatetime);
    let deadline = new Date("2025-03-21T09:00:00");
    let delayHours = Math.floor((arrivalDate - deadline) / (1000 * 60 * 60));
    addCriterion(
      "Arrived on time in DC",
      "Before Mar 21, 9 AM",
      arrivalDate <= deadline,
      10 - Math.max(0, delayHours)
    );
  }

  // Arrival Time in SLC
  let slcArrival = cart.find((f) => f.arrivalCity === "Salt Lake City");
  if (slcArrival) {
    let arrivalDate = new Date(slcArrival.arrivalDatetime);
    let deadline = new Date("2025-03-25T08:00:00");
    let delayHours = Math.floor((arrivalDate - deadline) / (1000 * 60 * 60));
    addCriterion(
      "Arrived on time in SLC",
      "Before Mar 25, 8 AM",
      arrivalDate <= deadline,
      10 - Math.max(0, delayHours)
    );
  }

  // Departure Time from DC
  let washingtonDeparture = cart.find(
    (f) => f.departureCity === "Washington D.C."
  );
  if (washingtonDeparture) {
    let departureDate = new Date(washingtonDeparture.departureDatetime);
    let earliestAllowed = new Date("2025-03-23T20:00:00");
    addCriterion(
      "Left DC on time",
      "After Mar 23, 8 PM",
      departureDate >= earliestAllowed,
      departureDate >= earliestAllowed ? 10 : 0
    );
  }

  // Number of Stops
  let totalStops = cart.reduce(
    (sum, flight) => sum + (flight.layoverCount || 0),
    0
  );
  let stopPenalty = Math.min(10, totalStops * 2);
  addCriterion(
    "Number of Stops",
    "Lose 2 points per stop",
    true,
    10 - stopPenalty
  );

  // Total Travel Time
  let totalTravelTime = cart.reduce(
    (sum, flight) => sum + (flight.totalFlightDuration || 0),
    0
  );
  let travelPenalty = Math.floor((totalTravelTime - 12) / 2);
  addCriterion(
    "Total Travel Time",
    "Lose 1 point per 2 extra hours",
    true,
    10 - Math.max(0, travelPenalty)
  );

  res.render("results", { criteria, totalScore: points });
});

// Serve flights.ejs for the root URL
app.get("/", async (req, res) => {
  try {
    const citiesResponse = await new Promise((resolve, reject) => {
      db.query("SELECT DISTINCT city FROM Airports", (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    const cities = citiesResponse.map((row) => row.city);
    res.render("flights", { cities: cities });
  } catch (error) {
    console.error("Error fetching cities:", error);
    res.status(500).send("An error occurred while fetching cities.");
  }
});

// Start server
const PORT = process.env.PORT || 4000;
const HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
