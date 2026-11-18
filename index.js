import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import multer from "multer";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://studiospace-server-bgs9.onrender.com",
      // আপনার Vercel ফ্রন্টএন্ডের লাইভ ডোমেইন এখানেও প্রয়োজনে যুক্ত করতে পারেন
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Multer setup for image file handling (Memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// JWT Verification Middleware (HTTPOnly Cookie)
// ==========================================
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid token" });
  }
};

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");

    const db = client.db("studio-space");
    const studiosCollection = db.collection("studios");
    const bookingsCollection = db.collection("bookings");

    // ==========================================
    // 0. AUTHENTICATION COOKIE ROUTES (NEW ADDED)
    // ==========================================

    // Login / Issue JWT & Set HTTPOnly Cookie
    app.post("/api/auth/jwt", async (req, res) => {
      try {
        const user = req.body;
        if (!user?.email) {
          return res.status(400).json({ success: false, message: "Email is required for authentication" });
        }

        const token = jwt.sign(
          { email: user.email },
          process.env.JWT_SECRET || "your-secret-key",
          { expiresIn: "7d" }
        );

        const isProduction = process.env.NODE_ENV === "production";

        res.cookie("token", token, {
          httpOnly: true,
          secure: isProduction, // প্রোডাকশনে HTTPS এর জন্য true
          sameSite: isProduction ? "none" : "lax", // ক্রোস-ডোমেইন কুকির জন্য 'none'
          maxAge: 7 * 24 * 60 * 60 * 1000, // ৭ দিন
        });

        res.json({ success: true, message: "Token generated & cookie set successfully" });
      } catch (error) {
        res.status(500).json({ success: false, message: "Failed to generate token", error: error.message });
      }
    });

    // Logout / Clear Cookie
    app.post("/api/auth/logout", (req, res) => {
      try {
        const isProduction = process.env.NODE_ENV === "production";

        res.clearCookie("token", {
          httpOnly: true,
          secure: isProduction,
          sameSite: isProduction ? "none" : "lax",
        });

        res.json({ success: true, message: "Logged out successfully" });
      } catch (error) {
        res.status(500).json({ success: false, message: "Logout failed", error: error.message });
      }
    });

    // ==========================================
    // 1. IMAGE UPLOAD ROUTE (Server-side ImgBB)
    // ==========================================
    app.post("/api/upload", upload.single("image"), verifyToken, async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, message: "No image file provided" });
        }

        const formData = new FormData();
        const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
        formData.append("image", blob, req.file.originalname);
        formData.append("key", process.env.IMGBB_API_KEY);

        const imgbbRes = await fetch("https://api.imgbb.com/1/upload", {
          method: "POST",
          body: formData,
        });

        const data = await imgbbRes.json();

        if (!data.success) {
          return res.status(400).json({ success: false, message: "ImgBB upload failed" });
        }

        res.json({
          success: true,
          url: data.data.display_url,
        });
      } catch (error) {
        res.status(500).json({ success: false, message: "Server error during image upload", error: error.message });
      }
    });

    // ==========================================
    // 2. STUDIOS CRUD OPERATIONS
    // ==========================================

    // Add New Studio (Private)
    app.post("/api/studios", verifyToken, async (req, res) => {
      try {
        const studioData = req.body;

        if (!studioData.title || !studioData.category || !studioData.ownerEmail) {
          return res.status(400).json({ message: "Missing required studio fields." });
        }

        const newStudio = {
          ...studioData,
          hourlyRate: Number(studioData.hourlyRate),
          securityDeposit: Number(studioData.securityDeposit || 0),
          maxCapacity: Number(studioData.maxCapacity || 1),
          rating: 0,
          reviews: [],
          createdAt: new Date(),
        };

        const result = await studiosCollection.insertOne(newStudio);
        res.status(201).json({
          success: true,
          message: "Studio created successfully!",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to create studio", error: error.message });
      }
    });

    // Explore All Studios with Search & Category Filter
    app.get("/api/studios", async (req, res) => {
      try {
        const { category, search, sort } = req.query;
        const query = {};

        if (category && category !== "all") {
          query.category = category;
        }

        if (search) {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
          ];
        }

        let sortOption = { createdAt: -1 };
        if (sort === "price_asc") sortOption = { hourlyRate: 1 };
        if (sort === "price_desc") sortOption = { hourlyRate: -1 };

        const studios = await studiosCollection.find(query).sort(sortOption).toArray();
        res.json(studios);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch studios", error: error.message });
      }
    });

    // Get Single Studio Details
    app.get("/api/studios/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Studio ID format" });
        }

        const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
        if (!studio) {
          return res.status(404).json({ message: "Studio not found" });
        }

        res.json(studio);
      } catch (error) {
        res.status(500).json({ message: "Error fetching studio details", error: error.message });
      }
    });

    // Get User's Own Studio Listings
    app.get("/api/my-studios/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const myStudios = await studiosCollection
          .find({ ownerEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(myStudios);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch your studios", error: error.message });
      }
    });

    // Update Studio (Private)
    app.patch("/api/studios/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const updatedData = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Studio ID" });
        }

        delete updatedData._id;
        delete updatedData.ownerEmail;
        delete updatedData.ownerName;

        if (updatedData.hourlyRate) updatedData.hourlyRate = Number(updatedData.hourlyRate);
        if (updatedData.securityDeposit) updatedData.securityDeposit = Number(updatedData.securityDeposit);
        if (updatedData.maxCapacity) updatedData.maxCapacity = Number(updatedData.maxCapacity);
        updatedData.updatedAt = new Date();

        const result = await studiosCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Studio not found" });
        }

        res.json({ success: true, message: "Studio updated successfully!" });
      } catch (error) {
        res.status(500).json({ message: "Failed to update studio", error: error.message });
      }
    });

    // Delete Studio (Private)
    app.delete("/api/studios/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Studio ID" });
        }

        const result = await studiosCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Studio not found" });
        }

        res.json({ success: true, message: "Studio deleted successfully!" });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete studio", error: error.message });
      }
    });

    // ==========================================
    // 3. BOOKING SYSTEM OPERATIONS
    // ==========================================

    // Create a New Booking (Private)
    app.post("/api/bookings", verifyToken, async (req, res) => {
      try {
        const bookingData = req.body;

        if (!bookingData.studioId || !bookingData.userEmail || !bookingData.bookingDate) {
          return res.status(400).json({ message: "Missing required booking information." });
        }

        const newBooking = {
          ...bookingData,
          totalPrice: Number(bookingData.totalPrice),
          status: "Pending",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(newBooking);
        res.status(201).json({
          success: true,
          message: "Booking request submitted! Status is Pending.",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to create booking", error: error.message });
      }
    });

    // Get User Bookings
    app.get("/api/bookings/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const bookings = await bookingsCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(bookings);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch bookings", error: error.message });
      }
    });

    // Cancel Pending Booking
    app.patch("/api/bookings/:id/cancel", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Booking ID" });
        }

        const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
        if (!booking) {
          return res.status(404).json({ message: "Booking not found" });
        }

        if (booking.status !== "Pending") {
          return res
            .status(400)
            .json({ message: "Only Pending bookings can be cancelled." });
        }

        await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "Cancelled", cancelledAt: new Date() } }
        );

        res.json({ success: true, message: "Booking cancelled successfully." });
      } catch (error) {
        res.status(500).json({ message: "Failed to cancel booking", error: error.message });
      }
    });

    // Health Check Route
    app.get("/", (req, res) => {
      res.send("StudioSpace API Server is running smoothly!");
    });
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
  }
}

run();

app.listen(port, () => {
  console.log(`StudioSpace server listening on port ${port}`);
});