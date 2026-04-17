require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// In-memory storage for the pending report
let pendingReport = null;

// Endpoint for the local script to submit a report for approval
app.post("/submit", (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).send("No message provided");

    pendingReport = message;
    console.log("📥 Received new report for approval");
    res.send({ status: "Pending approval" });
});

// Endpoint for the "Approve" button click from Teams
app.get("/approve", async (req, res) => {
    if (!pendingReport) {
        return res.send("<h1>⚠️ Error</h1><p>No pending report found. It may have already been processed.</p>");
    }

    try {
        // Post to the PUBLIC CHANNEL
        const channelWebhookUrl = process.env.TEAMS_CHANNEL_WEBHOOK_URL;
        await axios.post(channelWebhookUrl, { text: pendingReport });

        pendingReport = null; // Clear after sending
        res.send("<h1>✅ Approved!</h1><p>The EOD has been sent to the MAIN channel.</p>");
        console.log("👍 Report approved and sent to public channel");
    } catch (err) {
        res.status(500).send("<h1>❌ Failed to send</h1><p>" + err.message + "</p>");
    }
});

// Endpoint for the "Reject" button
app.get("/reject", (req, res) => {
    pendingReport = null;
    res.send("<h1>🚫 Rejected</h1><p>The report was discarded and not sent.</p>");
    console.log("👎 Report rejected");
});

// Health check
app.get("/", (req, res) => {
    res.send("🚀 BUD Approval Server is running...");
});

app.listen(port, () => {
    console.log(`📡 Render server listening on port ${port}`);
});
