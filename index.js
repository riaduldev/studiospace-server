import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";


const app = express();
const port = Number(process.env.PORT) || 8000;
const isProduction =
  process.env.NODE_ENV === "production" || process.env.RENDER === "true";

  
const defaultOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://studiospace-client-eta.vercel.app",
];
const configuredOrigins = (process.env.CLIENT_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function resolveAuthBaseUrl() {
  const configured = process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, "");
  const configuredUrl = configured ? parseHttpUrl(configured) : null;
  const pointsToLocalhost =
    configuredUrl &&
    ["localhost", "127.0.0.1", "::1"].includes(configuredUrl.hostname);

  if (configuredUrl && !(isProduction && pointsToLocalhost)) {
    return configuredUrl.origin;
  }

  if (configured) {
    console.warn(
      "BETTER_AUTH_URL is invalid or points to localhost in production; using the deployed client URL instead."
    );
  }

  return isProduction
    ? "https://studiospace-client-eta.vercel.app"
    : "http://localhost:3000";
}

const authBaseUrl = resolveAuthBaseUrl();
allowedOrigins.add(authBaseUrl);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const mongoUri = requireEnv("MONGODB_URI");
const imgbbApiKey = process.env.IMGBB_API_KEY?.trim();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      console.warn("Blocked by CORS:", origin);
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function studioGallery(coverImage, galleryImages) {
  const images = normalizeStringArray(galleryImages).filter(
    (image) => image !== coverImage
  );
  return coverImage ? [coverImage, ...images] : images;
}

function isValidBookingDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function requireAuth(req, res, next) {
  const cookie = req.headers.cookie;
  const authorization = req.headers.authorization;

  if (!cookie && !authorization) {
    return sendError(res, 401, "Please log in to continue.");
  }

  try {
    const headers = { accept: "application/json" };
    if (cookie) headers.cookie = cookie;
    if (authorization) headers.authorization = authorization;

    const response = await fetch(`${authBaseUrl}/api/auth/get-session`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return sendError(res, 401, "Your session is no longer valid.");
    }

    const session = await response.json().catch(() => null);
    const email = text(session?.user?.email);

    if (!email) {
      return sendError(res, 401, "Please log in to continue.");
    }

    req.auth = {
      user: session.user,
      session: session.session,
    };
    return next();
  } catch (error) {
    console.error("Session validation failed:", error);
    return sendError(res, 503, "Authentication service is unavailable.");
  }
}

const mongoClient = new MongoClient(mongoUri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let studiosCollection;
let bookingsCollection;
let favoritesCollection;

async function connectToDatabase() {
  await mongoClient.connect();

  const db = mongoClient.db("studio-space");
  studiosCollection = db.collection("studios");
  bookingsCollection = db.collection("bookings");
  favoritesCollection = db.collection("favorites");

  try {
    await Promise.all([
      studiosCollection.createIndex({ ownerEmail: 1, createdAt: -1 }),
      bookingsCollection.createIndex({ userEmail: 1, createdAt: -1 }),
      bookingsCollection.createIndex({ userEmail: 1, studioId: 1 }),
      favoritesCollection.createIndex({ userEmail: 1, studioId: 1 }, { unique: true }),
    ]);
  } catch (error) {
    console.warn("Database index setup failed:", error.message);
  }

  console.log("You successfully connected to MongoDB!");
}

app.get("/", (req, res) => {
  res.send("StudioSpace API Server is running smoothly!");
});

app.get("/api/studios", async (req, res) => {
  try {
    const { category, search, sort } = req.query;
    const query = {};

    if (typeof category === "string" && category && category !== "all") {
      query.category = category;
    }

    if (typeof search === "string" && search.trim()) {
      const escapedSearch = search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { title: { $regex: escapedSearch, $options: "i" } },
        { location: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    let sortOption = { createdAt: -1 };
    if (sort === "price_asc") sortOption = { hourlyRate: 1 };
    if (sort === "price_desc") sortOption = { hourlyRate: -1 };

    const studios = await studiosCollection
      .find(query)
      .sort(sortOption)
      .toArray();

    res.json(studios);
  } catch (error) {
    console.error("Failed to fetch studios:", error);
    sendError(res, 500, "Failed to fetch studios.");
  }
});

app.get("/api/studios/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid studio ID.");
    }

    const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });

    if (!studio) {
      return sendError(res, 404, "Studio not found.");
    }

    res.json(studio);
  } catch (error) {
    console.error("Failed to fetch studio:", error);
    sendError(res, 500, "Failed to fetch studio details.");
  }
});

app.get("/api/my-studios", requireAuth, async (req, res) => {
  try {
    const studios = await studiosCollection
      .find({ ownerEmail: req.auth.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(studios);
  } catch (error) {
    console.error("Failed to fetch owned studios:", error);
    sendError(res, 500, "Failed to fetch your studios.");
  }
});

app.get("/api/my-studios/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid studio ID.");
    }

    const studio = await studiosCollection.findOne({
      _id: new ObjectId(id),
      ownerEmail: req.auth.user.email,
    });

    if (!studio) {
      return sendError(res, 404, "Studio not found or you do not own it.");
    }

    res.json(studio);
  } catch (error) {
    console.error("Failed to fetch owned studio:", error);
    sendError(res, 500, "Failed to fetch studio details.");
  }
});

app.post("/api/studios", requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const title = text(body.title);
    const category = text(body.category);
    const location = text(body.location);
    const imageUrl = text(body.imageUrl);
    const hourlyRate = Number(body.hourlyRate);
    const securityDeposit =
      body.securityDeposit === undefined || body.securityDeposit === ""
        ? 0
        : Number(body.securityDeposit);
    const maxCapacity =
      body.maxCapacity === undefined || body.maxCapacity === ""
        ? 1
        : Number(body.maxCapacity);

    if (!title || !category || !location || !imageUrl) {
      return sendError(
        res,
        400,
        "Title, category, location, and image are required."
      );
    }

    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      return sendError(res, 400, "Hourly rate must be greater than zero.");
    }

    if (!Number.isFinite(securityDeposit) || securityDeposit < 0) {
      return sendError(res, 400, "Security deposit must be zero or greater.");
    }

    if (!Number.isInteger(maxCapacity) || maxCapacity < 1) {
      return sendError(res, 400, "Max capacity must be at least one.");
    }

    const newStudio = {
      title,
      category,
      hourlyRate,
      securityDeposit,
      maxCapacity,
      location,
      overview: text(body.overview),
      imageUrl,
      galleryImages: studioGallery(imageUrl, body.galleryImages),
      amenities: normalizeStringArray(body.amenities),
      ownerName: req.auth.user.name || req.auth.user.email,
      ownerEmail: req.auth.user.email,
      rating: 0,
      reviews: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await studiosCollection.insertOne(newStudio);

    res.status(201).json({
      success: true,
      message: "Studio created successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Failed to create studio:", error);
    sendError(res, 500, "Failed to create studio.");
  }
});

app.patch("/api/studios/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid studio ID.");
    }

    const studio = await studiosCollection.findOne({
      _id: new ObjectId(id),
      ownerEmail: req.auth.user.email,
    });

    if (!studio) {
      return sendError(res, 404, "Studio not found or you do not own it.");
    }

    const body = req.body ?? {};
    const updates = {};

    if (body.title !== undefined) {
      const title = text(body.title);
      if (!title) return sendError(res, 400, "Title cannot be empty.");
      updates.title = title;
    }

    if (body.category !== undefined) {
      const category = text(body.category);
      if (!category) return sendError(res, 400, "Category cannot be empty.");
      updates.category = category;
    }

    if (body.location !== undefined) {
      const location = text(body.location);
      if (!location) return sendError(res, 400, "Location cannot be empty.");
      updates.location = location;
    }

    if (body.overview !== undefined) {
      updates.overview = text(body.overview);
    }

    if (body.imageUrl !== undefined) {
      const imageUrl = text(body.imageUrl);
      if (!imageUrl) return sendError(res, 400, "Image cannot be empty.");
      updates.imageUrl = imageUrl;
    }

    if (body.hourlyRate !== undefined) {
      const hourlyRate = Number(body.hourlyRate);
      if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
        return sendError(res, 400, "Hourly rate must be greater than zero.");
      }
      updates.hourlyRate = hourlyRate;
    }

    if (body.securityDeposit !== undefined) {
      const securityDeposit = Number(body.securityDeposit);
      if (!Number.isFinite(securityDeposit) || securityDeposit < 0) {
        return sendError(res, 400, "Security deposit must be zero or greater.");
      }
      updates.securityDeposit = securityDeposit;
    }

    if (body.maxCapacity !== undefined) {
      const maxCapacity = Number(body.maxCapacity);
      if (!Number.isInteger(maxCapacity) || maxCapacity < 1) {
        return sendError(res, 400, "Max capacity must be at least one.");
      }
      updates.maxCapacity = maxCapacity;
    }

    if (body.amenities !== undefined) {
      updates.amenities = normalizeStringArray(body.amenities);
    }

    if (body.galleryImages !== undefined) {
      updates.galleryImages = normalizeStringArray(body.galleryImages);
    }

    const nextImageUrl = updates.imageUrl ?? studio.imageUrl;
    if (updates.imageUrl !== undefined || updates.galleryImages !== undefined) {
      updates.galleryImages = studioGallery(
        nextImageUrl,
        updates.galleryImages ?? studio.galleryImages
      );
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, 400, "No studio fields were provided.");
    }

    updates.updatedAt = new Date();

    await studiosCollection.updateOne(
      { _id: new ObjectId(id), ownerEmail: req.auth.user.email },
      { $set: updates }
    );

    res.json({ success: true, message: "Studio updated successfully!" });
  } catch (error) {
    console.error("Failed to update studio:", error);
    sendError(res, 500, "Failed to update studio.");
  }
});

app.delete("/api/studios/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid studio ID.");
    }

    const result = await studiosCollection.deleteOne({
      _id: new ObjectId(id),
      ownerEmail: req.auth.user.email,
    });

    if (result.deletedCount === 0) {
      return sendError(res, 404, "Studio not found or you do not own it.");
    }

    res.json({ success: true, message: "Studio deleted successfully!" });
  } catch (error) {
    console.error("Failed to delete studio:", error);
    sendError(res, 500, "Failed to delete studio.");
  }
});

app.get("/api/bookings", requireAuth, async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find({ userEmail: req.auth.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(bookings);
  } catch (error) {
    console.error("Failed to fetch bookings:", error);
    sendError(res, 500, "Failed to fetch bookings.");
  }
});

app.post("/api/bookings", requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const studioId = text(body.studioId);
    const bookingDate = text(body.bookingDate);

    if (!ObjectId.isValid(studioId)) {
      return sendError(res, 400, "Invalid studio ID.");
    }

    if (!isValidBookingDate(bookingDate)) {
      return sendError(res, 400, "Please provide a valid booking date.");
    }

    const studio = await studiosCollection.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return sendError(res, 404, "Studio not found.");
    }

    const activeBooking = await bookingsCollection.findOne({
      studioId,
      userEmail: req.auth.user.email,
      status: { $in: ["Pending", "Confirmed"] },
    });

    if (activeBooking) {
      return sendError(
        res,
        409,
        `You already have a ${activeBooking.status.toLowerCase()} booking for this studio.`
      );
    }

    const sessionHours = 4;
    const totalPrice =
      Number(studio.hourlyRate) * sessionHours +
      Number(studio.securityDeposit ?? 0);

    const newBooking = {
      studioId,
      studioTitle: studio.title,
      studioLocation: studio.location,
      studioImageUrl: studio.imageUrl,
      bookingDate,
      sessionHours,
      hourlyRate: Number(studio.hourlyRate),
      securityDeposit: Number(studio.securityDeposit ?? 0),
      totalPrice,
      status: "Pending",
      userEmail: req.auth.user.email,
      userName: req.auth.user.name || req.auth.user.email,
      createdAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(newBooking);

    res.status(201).json({
      success: true,
      message: "Booking request submitted! Status is Pending.",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Failed to create booking:", error);
    sendError(res, 500, "Failed to create booking.");
  }
});

app.patch("/api/bookings/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid booking ID.");
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
      userEmail: req.auth.user.email,
    });

    if (!booking) {
      return sendError(res, 404, "Booking not found.");
    }

    if (booking.status !== "Pending") {
      return sendError(res, 400, "Only Pending bookings can be cancelled.");
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(id), userEmail: req.auth.user.email },
      { $set: { status: "Cancelled", cancelledAt: new Date() } }
    );

    res.json({ success: true, message: "Booking cancelled successfully." });
  } catch (error) {
    console.error("Failed to cancel booking:", error);
    sendError(res, 500, "Failed to cancel booking.");
  }
});

app.post(
  "/api/upload",
  requireAuth,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return sendError(res, 400, "No image file provided.");
      }

      if (!req.file.mimetype.startsWith("image/")) {
        return sendError(res, 400, "Only image files are allowed.");
      }

      if (!imgbbApiKey) {
        return sendError(res, 500, "Image uploads are not configured.");
      }

      const formData = new FormData();
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      formData.append("image", blob, req.file.originalname);
      formData.append("key", imgbbApiKey);

      const imgbbResponse = await fetch("https://api.imgbb.com/1/upload", {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(30000),
      });
      const data = await imgbbResponse.json().catch(() => null);

      if (!imgbbResponse.ok || !data?.success || !data?.data?.display_url) {
        return sendError(res, 400, "Image upload failed.");
      }

      res.json({ success: true, url: data.data.display_url });
    } catch (error) {
      console.error("Failed to upload image:", error);
      sendError(res, 500, "Server error during image upload.");
    }
  }
);

// ---------- Favorites (Saved Studios Wishlist) ----------

app.get("/api/favorites", requireAuth, async (req, res) => {
  try {
    const favorites = await favoritesCollection
      .find({ userEmail: req.auth.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    const studioIds = favorites
      .map((favorite) => favorite.studioId)
      .filter((id) => ObjectId.isValid(id));

    const studios = studioIds.length
      ? await studiosCollection
          .find({ _id: { $in: studioIds.map((id) => new ObjectId(id)) } })
          .toArray()
      : [];

    const studioMap = new Map(
      studios.map((studio) => [String(studio._id), studio])
    );

    const ordered = favorites
      .map((favorite) => studioMap.get(favorite.studioId))
      .filter(Boolean);

    res.json(ordered);
  } catch (error) {
    console.error("Failed to fetch favorites:", error);
    sendError(res, 500, "Failed to fetch saved studios.");
  }
});

app.get("/api/favorites/ids", requireAuth, async (req, res) => {
  try {
    const favorites = await favoritesCollection
      .find({ userEmail: req.auth.user.email })
      .project({ studioId: 1 })
      .toArray();

    res.json(favorites.map((favorite) => favorite.studioId));
  } catch (error) {
    console.error("Failed to fetch favorite ids:", error);
    sendError(res, 500, "Failed to fetch saved studio ids.");
  }
});

app.post("/api/favorites/:studioId", requireAuth, async (req, res) => {
  try {
    const { studioId } = req.params;

    if (!ObjectId.isValid(studioId)) {
      return sendError(res, 400, "Invalid studio ID.");
    }

    const studio = await studiosCollection.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return sendError(res, 404, "Studio not found.");
    }

    try {
      await favoritesCollection.insertOne({
        userId: req.auth.user.id ?? req.auth.user.email,
        userEmail: req.auth.user.email,
        studioId,
        createdAt: new Date(),
      });
    } catch (error) {
      // Duplicate key -> already favorited; treat as success.
      if (error && error.code !== 11000) {
        throw error;
      }
    }

    res.status(201).json({ success: true, message: "Studio saved." });
  } catch (error) {
    console.error("Failed to save favorite:", error);
    sendError(res, 500, "Failed to save studio.");
  }
});

app.delete("/api/favorites/:studioId", requireAuth, async (req, res) => {
  try {
    const { studioId } = req.params;

    if (!ObjectId.isValid(studioId)) {
      return sendError(res, 400, "Invalid studio ID.");
    }

    await favoritesCollection.deleteOne({
      userEmail: req.auth.user.email,
      studioId,
    });

    res.json({ success: true, message: "Studio removed from favorites." });
  } catch (error) {
    console.error("Failed to remove favorite:", error);
    sendError(res, 500, "Failed to remove saved studio.");
  }
});

app.use((req, res) => {
  sendError(res, 404, "Route not found.");
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be 10 MB or smaller."
        : error.message;
    return sendError(res, 400, message);
  }

  console.error("Unhandled server error:", error);
  sendError(res, 500, "Unexpected server error.");
});

connectToDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`StudioSpace server listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start StudioSpace API:", error);
    process.exit(1);
  });
