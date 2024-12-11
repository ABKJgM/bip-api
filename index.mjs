'use strict';

// ESM import statements
import express from 'express';
import fs from 'fs';
import { connect } from 'http2';
import { join } from 'path';
import { Transform } from "stream";
import { parse } from 'node-html-parser';
import session from 'express-session';
import path from 'path';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
import cors from 'cors';
import bcrypt from 'bcrypt'; // Password hashing
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import crypto from "crypto";
import { format, parseISO } from 'date-fns';



const app = express();
app.use(express.json());

app.use(session({
    secret: 'priv_key',
    resave: false,
    saveUninitialized: true
}));

app.use(
    cors({
        origin: "http://localhost:3000", // Replace with your frontend's origin
        credentials: true, // Allow cookies and session data
    })
);

app.use(express.static(join(process.cwd(), './public')));
// `__dirname` is not available in ESM; use `process.cwd()` or `import.meta.url`

const uri = "mongodb+srv://biportal06:ilhancavcav06@bip0.yhvai.mongodb.net/?retryWrites=true&w=majority&appName=BIP0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Connect to the MongoDB server
await client.connect();

app.post("/apply-tour", async (req, res) => {
    const {
        city,
        district,
        schoolName,
        website,
        organizationEmail,
        teacherName,
        teacherSurname,
        teacherEmail,
        teacherPhone,
        groupSize,
        classInfo,
        tourDate,
        tourTime, // Include these fields
        guide,
    } = req.body;

    // Validation
    if (
        !city ||
        !district ||
        !schoolName ||
        !website ||
        !organizationEmail ||
        !teacherName ||
        !teacherSurname ||
        !teacherEmail ||
        !teacherPhone ||
        !groupSize ||
        !classInfo ||
        !tourDate || // Validate tourDate
        !tourTime // Validate tourTime
    ) {
        return res.status(400).json({ error: "All fields are required." });
    }

    // Email Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(organizationEmail) || !emailRegex.test(teacherEmail)) {
        return res.status(400).json({ error: "Invalid email format." });
    }

    // Phone Validation (basic example for digits only)
    const phoneRegex = /^\d+$/;
    if (!phoneRegex.test(teacherPhone)) {
        return res.status(400).json({ error: "Invalid phone number format." });
    }

    // Group Size Validation
    const maxGroupSize = 50;
    if (groupSize < 1 || groupSize > maxGroupSize) {
        return res.status(400).json({ error: `Group size must be between 1 and ${maxGroupSize}.` });
    }

    // Database insertion
    try {
        const result = await client
            .db("Tours")
            .collection("Applications")
            .insertOne({
                city,
                district,
                schoolName,
                website,
                organizationEmail,
                teacherName,
                teacherSurname,
                teacherEmail,
                teacherPhone,
                groupSize,
                classInfo,
                tourDate, // Save tourDate
                tourTime, // Save tourTime
                guide: guide || null, // Optional guide field
                status: "Waiting",
                createdAt: new Date(),
            });

        console.log("Application stored:", result);

        return res.status(201).json({
            message: "Application submitted successfully",
            applicationId: result.insertedId,
        });
    } catch (error) {
        console.error("Error storing application:", error);

        if (error.name === "MongoNetworkError") {
            return res.status(500).json({ error: "Database connection failed. Please try again later." });
        }

        return res.status(500).json({ error: "An error occurred while submitting the application." });
    }
});


app.get("/get-available-guides", async (req, res) => {
    const { tourDate, tourTime } = req.query;
  
    if (!tourDate || !tourTime) {
      return res.status(400).json({ error: "tourDate and tourTime are required." });
    }
  
    try {
      // Parse the given tourDate to a Date object
      const dateObj = parseISO(tourDate);
      // Extract weekday name: format returns "Monday", "Tuesday", etc.
      const weekday = format(dateObj, 'EEEE');
  
      // Fetch all guides
      const guides = await client.db("users").collection("users").find({ role: "guide" }).toArray();
      const guideUsernames = guides.map(g => g.username);
  
      // Get all schedules for these guides
      const schedules = await client.db("GuideCollections").collection("Schedules").find({ username: { $in: guideUsernames } }).toArray();
  
      // Create a map for quick schedule access by username
      const scheduleMap = {};
      schedules.forEach(sch => {
        scheduleMap[sch.username] = sch.schedule;
      });
  
      // Filter only the guides that have the given tourTime on the given weekday
      const availableGuides = guides.filter(guide => {
        const sch = scheduleMap[guide.username];
        return sch && sch[weekday] && sch[weekday].includes(tourTime);
      });
  
      return res.status(200).json(availableGuides);
    } catch (error) {
      console.error("Error fetching available guides:", error);
      return res.status(500).json({ error: "Error occurred while fetching available guides." });
    }
  });


app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
    }

    try {
        // Find the user by username
        const user = await client.db("users").collection("users").findOne({ username });

        // Check if user exists
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Compare provided password with stored hashed password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            console.log(`Unsuccessful login attempt: ${username}`);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Set session details
        req.session.isAuthenticated = true;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.name = user.name;
        req.session.surname = user.surname;
        console.log(`User ${username} logged in successfully`);

        // Respond with user details
        return res.status(200).json({
            message: "Login successful",
            role: user.role, // Send the user's role to the frontend
            username: user.username,
            name: user.name,
            surname: user.surname,
            _id: user._id,
        });
    } catch (error) {
        console.error("Error during login:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/logout", (req, res) => {
    if (req.session) {
        // Destroy the session
        req.session.destroy((err) => {
            if (err) {
                console.error("Error destroying session:", err);
                return res.status(500).json({ error: "Failed to log out." });
            }
            res.clearCookie("connect.sid"); // Clear the session cookie
            return res.status(200).json({ message: "Successfully logged out." });
        });
    } else {
        return res.status(400).json({ error: "No session found to log out." });
    }
});

app.get("/authorization", (req, res) => {
    // Check if the user session exists
    if (!req.session || !req.session.username) {
        return res.status(401).json({ error: "Unauthorized access. Please log in." });
    }

    // Extract user details from the session
    const { name, surname, role } = req.session;

    if (!name || !surname || !role) {
        return res.status(400).json({ error: "Incomplete user session data." });
    }

    // Respond with user information
    return res.status(200).json({
        name,
        surname,
        role,
    });
});


app.post("/register", async (req, res) => {
    const { username, name, surname, role, email } = req.body;

    // Validation
    if (!username || !name || !surname || !role || !email) {
        return res.status(400).json({ error: "All fields are required" });
    }

    try {
        const existingUser = await client
            .db("users")
            .collection("users")
            .findOne({ username });

        if (existingUser) {
            return res.status(400).json({ error: "User already exists" });
        }

        // Generate a random password
        const generatedPassword = Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);

        const result = await client.db("users").collection("users").insertOne({
            username,
            password: hashedPassword,
            name,
            surname,
            role,
            email,
            createdAt: new Date(),
        });

        // Email Setup
        let transporter = nodemailer.createTransport({
            host: 'smtp.zoho.eu',
            port: 465,
            secure: true,
            auth: {
                user: "biportal@zohomail.eu",
                pass: "ilhancavcav06"
            }
        });

        // Email Content
        const mailOptions = {
            from: `"University Tours" <biportal@zohomail.eu>`,
            to: email,
            subject: "Welcome to University Tours",
            text: `Hello ${name} ${surname},\n\nYou have been registered as a ${role} in the system.\n\nHere are your login details:\nUsername: ${username}\nPassword: ${generatedPassword}\n\nBest regards,\nUniversity Tours`
        };

        // Send Email
        await transporter.sendMail(mailOptions);

        res.status(201).json({ message: "User registered and email sent successfully", userId: result.insertedId });
    } catch (error) {
        console.error("Error during registration:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


app.get("/get-waiting-applications", async (req, res) => {
    try {
        const waitingApplications = await client
            .db("Tours")
            .collection("Applications")
            .find({ status: "Waiting" })
            .toArray();

        // Always return an array, even if empty
        return res.status(200).json(waitingApplications || []);
    } catch (error) {
        console.error("Error fetching waiting applications:", error);
        return res.status(500).json({ error: "An error occurred while fetching the applications" });
    }
});


app.post("/approve-applications", async (req, res) => {
    const { applicationIds } = req.body;

    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
        return res.status(400).json({ error: "No application IDs provided" });
    }

    try {
        const objectIds = applicationIds.map((id) => new ObjectId(id));

        const result = await client
            .db("Tours")
            .collection("Applications")
            .updateMany(
                { _id: { $in: objectIds } },
                { $set: { status: "Approved" } } // Update the status to "Approved"
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "No matching applications found." });
        }

        return res.status(200).json({ message: "Applications approved successfully." });
    } catch (error) {
        console.error("Error updating application status:", error);
        return res.status(500).json({ error: "An error occurred while approving applications." });
    }
});

app.post("/forgot-password", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        const user = await client.db("users").collection("users").findOne({ email });

        if (!user) {
            return res.status(404).json({ error: "User with this email not found" });
        }

        // Rastgele bir token oluştur
        const token = crypto.randomBytes(32).toString("hex");

        // Token'ı kullanıcıya ekle ve bir expiration date belirle
        await client.db("users").collection("users").updateOne(
            { email },
            { $set: { resetToken: token, resetTokenExpires: Date.now() + 3600000 } } // 1 saatlik geçerlilik
        );

        const resetLink = `http://localhost:3000/reset-password?token=${token}`;

        // Maili gönder
        let transporter = nodemailer.createTransport({
            host: "smtp.zoho.eu",
            port: 465,
            secure: true,
            auth: {
                user: "biportal@zohomail.eu",
                pass: "ilhancavcav06",
            },
        });

        const mailOptions = {
            from: `"University Tours" <biportal@zohomail.eu>`,
            to: email,
            subject: "Reset Your Password",
            text: `Hello ${user.name},\n\nClick the link below to reset your password:\n\n${resetLink}\n\nBest regards,\nBiPortal`,
        };

        await transporter.sendMail(mailOptions);

        return res.status(200).json({ message: "Password reset email sent successfully" });
    } catch (err) {
        console.error("Error sending reset password email:", err);
        return res.status(500).json({ error: "An error occurred while sending the reset email." });
    }
});


// Password reset endpoint

app.post("/reset-password", async (req, res) => {
    const { password } = req.body; // Yeni şifre
    const { token } = req.query; // Query string'den token alıyoruz

    if (!password || !token) {
        return res.status(400).json({ error: "Password and token are required" });
    }

    try {
        // Token ile kullanıcıyı bul
        const user = await client.db("users").collection("users").findOne({ resetToken: token });

        if (!user) {
            return res.status(400).json({ error: "Invalid or expired token" });
        }

        // Şifreyi hashle
        const hashedPassword = await bcrypt.hash(password, 10);

        // Kullanıcının şifresini güncelle ve token'ı temizle
        const result = await client
            .db("users")
            .collection("users")
            .updateOne(
                { resetToken: token },
                { $set: { password: hashedPassword }, $unset: { resetToken: "" } }
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.status(200).json({ message: "Password reset successfully" });
    } catch (err) {
        console.error("Error resetting password:", err);
        return res.status(500).json({ error: "An error occurred while resetting the password." });
    }
});

app.post("/delete-application", async (req, res) => {
    const { applicationId } = req.body;

    if (!applicationId) {
        return res.status(400).json({ error: "Application ID is required." });
    }

    try {
        const result = await client
            .db("Tours")
            .collection("Applications")
            .deleteOne({ _id: new ObjectId(applicationId) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Application not found." });
        }

        return res.status(200).json({ message: "Application denied successfully." });
    } catch (error) {
        console.error("Error deleting application:", error);
        return res.status(500).json({ error: "An error occurred while denying the application." });
    }
});

app.get("/get-verified-tours", async (req, res) => {
    try {
        const verifiedApplications = await client
            .db("Tours")
            .collection("Applications")
            .find({ status: { $in: ["Approved", "Guide Approved"] } }) // Include both statuses
            .toArray();

        // Always return an array, even if empty
        return res.status(200).json(verifiedApplications || []);
    } catch (error) {
        console.error("Error fetching verified tours:", error);
        return res.status(500).json({ error: "An error occurred while fetching verified tours" });
    }
});

app.get("/get-guides", async (req, res) => {
    try {
        const guides = await client
            .db("users") // Make sure this is the correct database name
            .collection("users") // Make sure this is the correct collection name
            .find({ role: "guide" }) // Query to find users with the "guide" role
            .toArray();

        if (guides.length === 0) {
            return res.status(404).json({ message: "No guides found" });
        }

        return res.status(200).json(guides);
    } catch (error) {
        console.error("Error fetching guides:", error);
        return res.status(500).json({ error: "An error occurred while fetching the guides" });
    }
});

app.get("/get-coordinators", async (req, res) => {
    try {
        const coordinators = await client
            .db("users")
            .collection("users")
            .find({ role: "coordinator" }) // Find users with role "coordinator"
            .toArray();

        if (!coordinators || coordinators.length === 0) {
            return res.status(404).json({ message: "No coordinators found" });
        }

        return res.status(200).json(coordinators);
    } catch (error) {
        console.error("Error fetching coordinators:", error);
        return res.status(500).json({ error: "An error occurred while fetching the coordinators" });
    }
});

app.get("/get-advisors", async (req, res) => {
    try {
        const advisors = await client
            .db("users")
            .collection("users")
            .find({ role: "advisor" }) // Find users with role "advisor"
            .toArray();

        if (!advisors || advisors.length === 0) {
            return res.status(404).json({ message: "No advisors found" });
        }

        return res.status(200).json(advisors);
    } catch (error) {
        console.error("Error fetching advisors:", error);
        return res.status(500).json({ error: "An error occurred while fetching the advisors" });
    }
});


app.post("/assign-guide", async (req, res) => {
    const { tourId, guideId } = req.body;

    if (!tourId || !guideId) {
        return res.status(400).json({ error: "Tour ID and Guide ID are required" });
    }

    try {
        // Retrieve guide info
        const guide = await client.db("users").collection("users").findOne({ _id: new ObjectId(guideId) });
        if (!guide) {
            return res.status(404).json({ error: "Guide not found" });
        }

        // Update tour with guide info and set status to "Guide Approved"
        const result = await client
            .db("Tours")
            .collection("Applications")
            .updateOne(
                { _id: new ObjectId(tourId) },
                { 
                  $set: { 
                    guide: { name: guide.name, surname: guide.surname, id: guide._id },
                    status: "Guide Approved"
                  } 
                }
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Tour not found" });
        }

        // Retrieve the updated tour
        const updatedTour = await client
            .db("Tours")
            .collection("Applications")
            .findOne({ _id: new ObjectId(tourId) });

        // Send notification email to the guide (optional)
        let transporter = nodemailer.createTransport({
            host: "smtp.zoho.eu",
            port: 465,
            secure: true,
            auth: {
                user: "biportal@zohomail.eu",
                pass: "ilhancavcav06",
            },
        });

        const mailOptions = {
            from: `"University Tours" <biportal@zohomail.eu>`,
            to: guide.email, // Guide's email
            subject: "New Assignment Notification",
            text: `Hello ${guide.name},\n\nYou have been assigned to a new tour.\n\nTour Details:\nSchool Name: ${updatedTour.schoolName}\nCity: ${updatedTour.city}\nDistrict: ${updatedTour.district}\n\nBest regards,\nBiPortal`,
        };

        await transporter.sendMail(mailOptions);

        return res.status(200).json(updatedTour);
    } catch (error) {
        console.error("Error assigning guide or sending email:", error);
        return res.status(500).json({ error: "An error occurred while assigning the guide or sending email." });
    }
});



app.delete("/delete-user", async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "User ID is required." });
    }

    try {
        const result = await client
            .db("users")
            .collection("users")
            .deleteOne({ _id: new ObjectId(userId) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        return res.status(200).json({ message: "User deleted successfully." });
    } catch (error) {
        console.error("Error deleting user:", error);
        return res.status(500).json({ error: "An error occurred while deleting the user." });
    }
});

app.post("/save-schedule", async (req, res) => {
    const { schedule } = req.body;
    const username = req.session.username;
    // Validation
    if (!username || !schedule) {
        return res.status(400).json({ error: "Username and schedule are required." });
    }

    // Check if schedule data is properly structured
    if (
        typeof schedule !== "object" ||
        !Object.keys(schedule).length ||
        !Array.isArray(schedule.Monday)
    ) {
        return res.status(400).json({ error: "Invalid schedule format." });
    }

    try {
        // Connect to the database
        //await client.connect();
        const db = client.db("GuideCollections");
        const collection = db.collection("Schedules");

        // Check if the guide's schedule already exists
        const existingSchedule = await client.db("GuideCollections").collection("Schedules").findOne({ "username": username });

        if (existingSchedule) {
            // Update existing schedule
            const updateResult = await collection.updateOne(
                { username },
                { $set: { schedule, updatedAt: new Date() } }
            );

            console.log("Schedule updated:", updateResult);
            return res.status(200).json({ message: "Schedule updated successfully." });
        } else {
            // Insert a new schedule
            const insertResult = await collection.insertOne({
                username,
                schedule,
                createdAt: new Date(),
            });

            console.log("Schedule saved:", insertResult);
            return res.status(201).json({ message: "Schedule saved successfully." });
        }
    } catch (error) {
        console.error("Error saving schedule:", error);

        // Handle database connection issues
        if (error.name === "MongoNetworkError") {
            return res.status(500).json({ error: "Database connection failed. Please try again later." });
        }

        return res.status(500).json({ error: "An error occurred while saving the schedule." });
    } finally {
        // Ensure the database connection is closed
        //await client.close();
    }
});

app.get("/get-schedule", async (req, res) => {
    // Ensure session middleware is set up and username exists in the session
    if (!req.session.isAuthenticated || !req.session.username || req.session.role != 'guide') {
        return res.status(401).json({ error: "Unauthorized. Please log in." });
    }

    const username = req.session.username;

    try {
        // Connect to the database
        //await client.connect();
        const db = client.db("GuideCollections");
        const collection = db.collection("Schedules");

        // Retrieve the guide's schedule
        const guideSchedule = await client.db("GuideCollections").collection("Schedules").findOne({ "username": username });

        if (!guideSchedule) {
            return res.status(404).json({ error: "Schedule not found for the user." });
        }

        // Return the schedule
        return res.status(200).json({
            username: guideSchedule.username,
            schedule: guideSchedule.schedule,
            createdAt: guideSchedule.createdAt,
            updatedAt: guideSchedule.updatedAt,
        });
    } catch (error) {
        console.error("Error retrieving schedule:", error);

        // Handle database connection issues
        if (error.name === "MongoNetworkError") {
            return res.status(500).json({ error: "Database connection failed. Please try again later." });
        }

        return res.status(500).json({ error: "An error occurred while retrieving the schedule." });
    } finally {
        // Ensure the database connection is closed
        //await client.close();
    }
});

app.get("/guide-proposals", async (req, res) => {
    const username = req.session.username; // Guide username from session

    if (!username) {
        return res.status(401).json({ error: "Unauthorized access. Please log in." });
    }

    try {
        const proposals = await client
            .db("Tours")
            .collection("Applications")
            .find({ guide: username, status: "Assigned" }) // Status: "Assigned"
            .toArray();

        if (!proposals || proposals.length === 0) {
            return res.status(404).json({ message: "No proposals found." });
        }

        return res.status(200).json(proposals);
    } catch (error) {
        console.error("Error fetching proposals:", error);
        return res.status(500).json({ error: "An error occurred while fetching proposals." });
    }
});

app.post("/approve-proposal", async (req, res) => {
    const { proposalId } = req.body;
    const { guideId } = req.body;

    if (!proposalId || !guideId) {
        return res.status(400).json({ error: "Proposal ID and guideId are required." });
    }

    try {
        const result = await client
            .db("Tours")
            .collection("Applications")
            .updateOne(
                { _id: new ObjectId(proposalId), "guide.id": new ObjectId(guideId) },
                { $set: { status: "Guide Approved" } } // Update status to "Guide Approved"
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Proposal not found or not assigned to you." });
        }

        return res.status(200).json({ message: "Proposal approved successfully." });
    } catch (error) {
        console.error("Error approving proposal:", error);
        return res.status(500).json({ error: "An error occurred while approving the proposal." });
    }
});
app.post("/deny-proposal", async (req, res) => {
    const { proposalId } = req.body;
    const { guideId } = req.body; // Guide ID'yi session'dan alın

    if (!proposalId || !guideId) {
        return res.status(400).json({ error: "Proposal ID and guide ID are required." });
    }

    try {
        const result = await client
            .db("Tours")
            .collection("Applications")
            .updateOne(
                { _id: new ObjectId(proposalId), "guide.id": new ObjectId(guideId) }, // Guide ID üzerinden eşleşme
                {
                    $set: { status: "Approved" }, // Durumu "Approved" olarak güncelle
                    $unset: { guide: "" } // Guide bilgilerini kaldır
                }
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Proposal not found or not assigned to you." });
        }

        return res.status(200).json({ message: "Proposal denied successfully." });
    } catch (error) {
        console.error("Error denying proposal:", error);
        return res.status(500).json({ error: "An error occurred while denying the proposal." });
    }
});


app.get("/get-assigned-tours", async (req, res) => {
    const { guideId } = req.query;

    if (!guideId) {
        return res.status(400).json({ error: "Guide ID is required." });
    }

    try {
        const assignedTours = await client
            .db("Tours")
            .collection("Applications")
            .find({ "guide.id": new ObjectId(guideId) }) // guide id'sine göre filtreleme
            .toArray();

        if (!assignedTours.length) {
            return res.status(404).json({ message: "No assigned tours found." });
        }

        return res.status(200).json(assignedTours);
    } catch (error) {
        console.error("Error fetching assigned tours:", error);
        return res.status(500).json({ error: "An error occurred while fetching assigned tours." });
    }
});

app.post("/assign-guide-to-tour", async (req, res) => {
    const { proposalId, guideId, guideName, guideSurname } = req.body;

    if (!proposalId || !guideId || !guideName || !guideSurname) {
        return res.status(400).json({ error: "Proposal ID, guide ID, and guide details are required." });
    }

    try {
        const result = await client
            .db("Tours")
            .collection("Applications")
            .updateOne(
                { _id: new ObjectId(proposalId), status: "Approved" },
                {
                    $set: {
                        guide: { id: new ObjectId(guideId), name: guideName, surname: guideSurname },
                        status: "Guide Approved"
                    },
                }
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Proposal not found or already assigned." });
        }

        return res.status(200).json({ message: "You have been successfully assigned to the tour." });
    } catch (error) {
        console.error("Error assigning guide to tour:", error);
        return res.status(500).json({ error: "An error occurred while assigning to the tour." });
    }
});


app.get("/get-guide-tours", async (req, res) => {
    const { guideId, guideName, guideSurname } = req.query;

    if (!guideId || !guideName || !guideSurname) {
        return res.status(400).json({ error: "Guide ID, name, and surname are required." });
    }

    try {
        const assignedTours = await client
            .db("Tours")
            .collection("Applications")
            .find({
                status: "Guide Approved",
                "guide.id": new ObjectId(guideId),
            })
            .toArray();

        if (!assignedTours || assignedTours.length === 0) {
            return res.status(404).json({ message: "No tours found for this guide." });
        }

        return res.status(200).json(assignedTours);
    } catch (error) {
        console.error("Error fetching guide tours:", error);
        return res.status(500).json({ error: "An error occurred while fetching guide tours." });
    }
});

app.post("/mark-tour-complete", async (req, res) => {
    const { tourId, guideId } = req.body;

    if (!tourId || !guideId) {
        return res.status(400).json({ error: "Tour ID and guide ID are required." });
    }

    try {
        const result = await client
            .db("Tours")
            .collection("Applications")
            .updateOne(
                { _id: new ObjectId(tourId), "guide.id": new ObjectId(guideId) }, // Match by tour ID and guide ID
                { $set: { status: "Completed" } } // Update status to "Completed"
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Tour not found or not assigned to this guide." });
        }

        return res.status(200).json({ message: "Tour marked as completed successfully." });
    } catch (error) {
        console.error("Error marking tour as completed:", error);
        return res.status(500).json({ error: "An error occurred while marking the tour as completed." });
    }
});


app.post("/send-approved-email", async (req, res) => {
    const { tourId, email } = req.body;

    if (!tourId || !email) {
        return res.status(400).json({ error: "Tour ID and email are required." });
    }

    try {
        // Mail gönderme yapılandırması
        let transporter = nodemailer.createTransport({
            host: "smtp.zoho.eu", // Zoho SMTP sunucusu
            port: 465, // Güvenli bağlantı için SSL portu
            secure: true, // SSL/TLS kullanımı
            auth: {
                user: "biportal@zohomail.eu", // Gönderen e-posta
                pass: "ilhancavcav06", // Şifre
            },
        });

        const mailOptions = {
            from: `"University Tours" <biportal@zohomail.eu>`, // Gönderen adres
            to: email, // Alıcı adres
            subject: "Tour Application Approved", // Konu
            text: `Dear Applicant,
  
  Your application for the tour (ID: ${tourId}) has been approved. Please contact us for further details regarding the next steps and tour arrangements.
  
  Best regards,
  University Tours Team`,
        };

        // Mail gönderimi
        await transporter.sendMail(mailOptions);

        return res.status(200).json({ message: "Email sent successfully!" });
    } catch (error) {
        console.error("Error sending email:", error.message || error);
        return res
            .status(500)
            .json({ error: "An error occurred while sending the email. Please try again later." });
    }
});

app.post("/apply-individual-tour", async (req, res) => {
    const { userName, userEmail, userPhone, tourDate, tourTime, major } = req.body;

    // Zorunlu alanları kontrol et
    if (!userName || !userEmail || !userPhone || !tourDate || !major) {
        return res.status(400).json({ error: "All fields are required." });
    }

    try {
        // Veriyi MongoDB'ye kaydet
        const result = await client
            .db("Tours")
            .collection("IndividualApplications")
            .insertOne({
                userName,
                userEmail,
                userPhone,
                tourDate,
                major,
                status: "Pending", // Varsayılan durum
                createdAt: new Date(), // Oluşturulma tarihi
            });

        // Başarılı yanıt gönder
        return res.status(201).json({
            message: "Individual tour application submitted successfully!",
            applicationId: result.insertedId,
        });
    } catch (error) {
        console.error("Error applying for individual tour:", error);
        return res.status(500).json({ error: "An error occurred while submitting the application." });
    }
});

app.listen(8080, () => {
    console.log('Uygulama çalıştırıldı...');
});
