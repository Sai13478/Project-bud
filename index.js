require("dotenv").config();
const axios = require("axios");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================

const AUTO_MODE = process.argv.includes("--auto");
const SCHEDULED_MODE = process.argv.includes("--scheduled");
const HEADLESS = AUTO_MODE || SCHEDULED_MODE;
const APPROVE_REQUIRED = process.env.APPROVE_REQUIRED === "true";

// ================= LOGGING =================

const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

function log(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}`;
    console.log(line);
}

// ================= CLI (only in interactive mode) =================

let rl = null;
if (!HEADLESS) {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

log("🤖 BUD started...");
if (AUTO_MODE) log("⚡ Running in AUTO mode");
if (SCHEDULED_MODE) log("📅 Running in SCHEDULED mode (Windows Task Scheduler)");

// ================= CLEAN TASK =================

function cleanTask(task) {
    if (!task) return "";
    let cleaned = task.trim();
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return cleaned;
}

// ================= GITHUB =================

async function getGitHubCommits() {
    try {
        const token = process.env.GITHUB_TOKEN;
        const username = process.env.GITHUB_USERNAME || "Sai13478";
        const filters = process.env.REPO_FILTERS 
            ? process.env.REPO_FILTERS.split(",").map(f => f.trim().toLowerCase()) 
            : [];
        
        if (!token) {
            log("⚠️ GITHUB_TOKEN not set in .env");
            return [];
        }

        log(`📡 Searching for today's behavior... ${filters.length > 0 ? `(Filtered: ${filters.join(", ")})` : "across all repos"}`);

        const today = new Date().toISOString().split("T")[0];
        const activeRepos = new Set();

        const isRepoAllowed = (fullName) => {
            if (filters.length === 0) return true;
            const repoNameOnly = fullName.split("/").pop().toLowerCase();
            return filters.some(f => f === fullName.toLowerCase() || f === repoNameOnly);
        };

        // 1. DISCOVER via Events feed
        try {
            const eventRes = await axios.get(`https://api.github.com/users/${username}/events`, {
                headers: { Authorization: `token ${token}` },
                params: { per_page: 50 },
            });
            eventRes.data.forEach(event => {
                const eventDate = event.created_at.split("T")[0];
                if (eventDate === today && event.type === "PushEvent") {
                    if (isRepoAllowed(event.repo.name)) {
                        activeRepos.add(event.repo.name);
                    }
                }
            });
        } catch (e) { log(`⚠️ Events feed fetch failed: ${e.message}`); }

        // 2. DISCOVER via Recently Pushed Repos
        try {
            const repoRes = await axios.get(`https://api.github.com/user/repos`, {
                headers: { Authorization: `token ${token}` },
                params: { per_page: 50, sort: "pushed" },
            });
            repoRes.data.forEach(repo => {
                const pushDate = repo.pushed_at.split("T")[0];
                if (pushDate === today) {
                    if (isRepoAllowed(repo.full_name)) {
                        activeRepos.add(repo.full_name);
                    }
                }
            });
        } catch (e) { log(`⚠️ Repo list fetch failed: ${e.message}`); }

        if (activeRepos.size === 0) {
            log("⚠️ No active repositories found today on GitHub.");
            return [];
        }

        log(`🔍 Found activity in ${activeRepos.size} repo(s). Fetching commit details...`);

        let allCommits = new Set();

        for (const repoName of Array.from(activeRepos)) {
            try {
                const commitRes = await axios.get(
                    `https://api.github.com/repos/${repoName}/commits`,
                    {
                        headers: { Authorization: `token ${token}` },
                        params: { since: `${today}T00:00:00Z` },
                    }
                );

                commitRes.data.forEach((c) => {
                    const commitDate = c.commit.author.date.split("T")[0];
                    if (commitDate === today) {
                        const msg = c.commit.message.split("\n")[0].trim();
                        if (msg && !msg.toLowerCase().includes("merge branch") && !msg.toLowerCase().includes("merged in")) {
                            allCommits.add(`[${repoName}] ${cleanTask(msg)}`);
                        }
                    }
                });

            } catch (e) {
                // Skip if error (e.g. empty repo)
            }
        }

        return Array.from(allCommits);

    } catch (err) {
        log(`⚠️ GitHub fetch failed: ${err.message}`);
        return [];
    }
}


// ================= SAVE =================

function saveEODToFile(message) {
    const today = new Date().toISOString().split("T")[0];

    const filePath = path.join(logsDir, `${today}.txt`);
    fs.writeFileSync(filePath, message);

    log(`💾 Saved → ${filePath}`);
}

// ================= TEAMS =================

async function sendToTeamsChannel(message) {
    try {
        if (!process.env.TEAMS_WEBHOOK_URL) {
            log("⚠️ TEAMS_WEBHOOK_URL not set in .env");
            return false;
        }

        await axios.post(process.env.TEAMS_WEBHOOK_URL, {
            text: message,
        });

        log("📤 Sent to Teams");
        return true;
    } catch (err) {
        log(`❌ Failed to send to Teams: ${err.message}`);
        return false;
    }
}

async function sendApprovalCard(message) {
    try {
        const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
        const baseUrl = process.env.APPROVAL_BASE_URL;

        if (!baseUrl) {
            log("⚠️ APPROVAL_BASE_URL not set in .env");
            return false;
        }

        const adaptiveCard = {
            type: "message",
            attachments: [
                {
                    contentType: "application/vnd.microsoft.card.adaptive",
                    content: {
                        type: "AdaptiveCard",
                        body: [
                            {
                                type: "TextBlock",
                                size: "Medium",
                                weight: "Bolder",
                                text: "🚀 BUD: EOD Approval Required",
                            },
                            {
                                type: "TextBlock",
                                text: "Please review the EOD report below and approve to send it to the main channel.",
                                wrap: true,
                            },
                            {
                                type: "Container",
                                style: "emphasis",
                                items: [
                                    {
                                        type: "TextBlock",
                                        text: message,
                                        wrap: true,
                                        fontType: "Monospace",
                                    },
                                ],
                            },
                        ],
                        actions: [
                            {
                                type: "Action.OpenUrl",
                                title: "✅ Approve & Send",
                                url: `${baseUrl}/approve`,
                            },
                            {
                                type: "Action.OpenUrl",
                                title: "❌ Reject",
                                url: `${baseUrl}/reject`,
                            },
                        ],
                        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                        version: "1.4",
                    },
                },
            ],
        };

        await axios.post(webhookUrl, adaptiveCard);
        log("📨 Approval card sent to Teams");
        return true;
    } catch (err) {
        log(`❌ Failed to send approval card: ${err.message}`);
        return false;
    }
}

// ================= BUILD =================

async function buildAndSend(tasks) {
    const today = new Date().toLocaleDateString();

    let eodMessage = `Date: ${today}\n`;
    eodMessage += "Updates:\n\n";

    tasks.forEach((t, i) => {
        eodMessage += `${i + 1}. ${t}\n`;
    });

    log("\n🔍 Preview:\n");
    log(eodMessage);

    // ===== AUTO / SCHEDULED MODE =====
    if (HEADLESS) {
        saveEODToFile(eodMessage);

        if (APPROVE_REQUIRED) {
            const baseUrl = process.env.APPROVAL_BASE_URL;
            log(`✋ Approval required! Sending to Render... ${baseUrl}`);
            
            try {
                // Submit to Render for approval
                await axios.post(`${baseUrl}/submit`, { message: eodMessage });
                
                // Send the interactive card to Teams
                await sendApprovalCard(eodMessage);
                
                log("✅ Submitted to Render. You can now approve in Teams. Script exiting.");
                process.exit(0);
            } catch (err) {
                log(`❌ Failed to submit for approval: ${err.message}`);
                process.exit(1);
            }
        } else {
            const sent = await sendToTeamsChannel(eodMessage);
            if (sent) {
                log("✅ Auto EOD complete");
                process.exit(0);
            } else {
                log("❌ EOD saved locally but Teams send failed");
                process.exit(1);
            }
        }
        return; 
    }

    // ===== MANUAL MODE =====
    rl.question("Send EOD to Teams? (yes/no): ", async (confirm) => {
        if (confirm.toLowerCase() === "yes") {
            saveEODToFile(eodMessage);
            await sendToTeamsChannel(eodMessage);
            log("✅ EOD complete");
        } else {
            log("❌ Cancelled");
        }
    });
}

// ================= MANUAL INPUT =================

function askManualTasks(tasks) {
    rl.question("Enter task (or 'done'): ", (task) => {

        if (task.toLowerCase() === "done") {
            if (tasks.length === 0) return askManualTasks(tasks);
            buildAndSend(tasks);
        } else {
            tasks.push(cleanTask(task));
            askManualTasks(tasks);
        }

    });
}

// ================= MAIN =================

async function handleEOD() {
    log("🔄 Generating EOD...");

    const isTest = process.argv.includes("--test");
    let commits = [];

    if (isTest) {
        log("🧪 TEST MODE: Using mock commits...");
        commits = [
            "[test-repo] Completed the Teams approval system implementation",
            "[test-repo] Cleaned up unused environment variables",
            "[test-repo] Added repository filtering support"
        ];
    } else {
        commits = await getGitHubCommits();
    }

    if (commits.length > 0) {
        log(`✅ Found ${commits.length} commit(s) ${isTest ? "(Mocked)" : "from GitHub"}`);
        await buildAndSend(commits);
    } else if (HEADLESS) {
        log("⚠️ No commits found today — nothing to send");
        process.exit(0);
    } else {
        log("⚠️ No commits → manual mode");
        askManualTasks([]);
    }
}

// ================= ENTRY POINT =================

if (HEADLESS) {
    // In scheduled/auto mode, run immediately
    handleEOD().catch((err) => {
        log(`💥 Fatal error: ${err.message}`);
        process.exit(1);
    });
} else {
    log("💡 Type 'exit' to quit. Starting EOD process...");
    
    // Start EOD immediately even in manual mode
    handleEOD().catch((err) => {
        log(`💥 Error: ${err.message}`);
    });

    // Listen for manual commands if the user wants to run it again
    rl.on("line", (input) => {
        const command = input.toLowerCase().trim();

        if (command.includes("send eod") || command === "run") {
            handleEOD();
        } else if (command === "exit") {
            log("👋 Goodbye");
            rl.close();
            process.exit();
        } else {
            log("❓ Unknown command. Type 'send eod' to run again or 'exit' to quit.");
        }
    });
}