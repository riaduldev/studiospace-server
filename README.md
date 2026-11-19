<div align="center">

# ⚙️ StudioSpace — Backend API
### RESTful API Server for Creative Workspace & Production Studio Booking Platform

[![Live API](https://img.shields.io/badge/Live_API-Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://studiospace-server-bgs9.onrender.com)
[![Client App](https://img.shields.io/badge/Client_App-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://studiospace-client-eta.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js_20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB_Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)

The core backend service powering **StudioSpace**. Built with Node.js, Express 5, and MongoDB Atlas, this REST API handles studio listings, search and multi-parameter filtering, 4-hour session bookings, per-user wishlists, cloud image uploads, and cross-origin Bearer session authentication.

[🔌 Live API Base URL](https://studiospace-server-bgs9.onrender.com) · [🌐 Live Frontend Application](https://studiospace-client-eta.vercel.app)

</div>

---

## 📋 Table of Contents
- [Technologies Used](#-technologies-used)
- [Key Features](#-key-features)
- [Project Structure](#-project-structure)
- [Local Installation & Setup](#-local-installation--setup)
- [Environment Variables](#-environment-variables)
- [API Route Contract](#-api-route-contract)
- [Deployment](#-deployment)
- [Author](#-author)

---

## 🚀 Technologies Used

| Category | Stack |
| :--- | :--- |
| **Runtime & Framework** | Node.js (≥ 20), Express 5, JavaScript (ES Modules / CommonJS) |
| **Database** | MongoDB Atlas (Native MongoDB Driver) |
| **Authentication** | Better Auth Session Validation (`/api/auth/get-session`) + Cross-Origin Bearer Token Middleware |
| **File & Media Handling** | Multer (`10 MB` file size limit) + ImgBB Cloud Image Hosting API |
| **Security & Middleware** | CORS (`CLIENT_ORIGINS` allowlist), `dotenv` |

---

## ✨ Key Features

- **🔐 Session Verification & Authorization:** Validates incoming `Authorization: Bearer <token>` headers against the Better Auth session endpoint to protect host and creator routes.
- **🏢 Studio Management (Full CRUD):** Create, retrieve, update, and delete creative studio listings with ownership verification (`my-studios`).
- **🔍 Dynamic Search & Filtering:** Supports keyword queries, category filtering, and location matching directly via MongoDB queries.
- **📅 Booking Management:** Handles 4-hour session reservations, booking history retrieval, and status updates (`cancelled`).
- **❤️ Favorite Studios (Wishlist):** Per-user wishlist endpoints supporting add, remove, full studio population, and lightweight ID lookups.
- **🖼️ Cloud Image Upload:** Accepts multipart image uploads via Multer and streams them directly to ImgBB for reliable CDN delivery.

---

## 📁 Project Structure

```text
studiospace-server/
├── index.js              # Express app setup, middleware, MongoDB connection & API routes
├── package.json          # Project dependencies and start/dev scripts
├── .env                  # Local environment variables (git-ignored)
└── README.md             # API documentation
