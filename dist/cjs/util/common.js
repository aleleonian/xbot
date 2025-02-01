"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorLog = exports.debugLog = exports.createSuccessResponse = exports.createErrorResponse = exports.wait = void 0;
exports.loadEnvFromUrl = loadEnvFromUrl;
const node_fetch_1 = require("node-fetch"); // You can use axios or native fetch if you're in the browser
const wait = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};
exports.wait = wait;
const createErrorResponse = (errorMessage) => {
    let responseObj = {};
    responseObj.success = false;
    responseObj.errorMessage = errorMessage;
    return responseObj;
};
exports.createErrorResponse = createErrorResponse;
const createSuccessResponse = (data) => {
    let responseObj = {};
    responseObj.success = true;
    if (data)
        responseObj.data = data;
    return responseObj;
};
exports.createSuccessResponse = createSuccessResponse;
const debugLog = (...strings) => {
    const debugValue = process.env.DEBUG;
    const string = strings.join(" "); // Join with space for readability
    if (debugValue) {
        console.log(string);
    }
};
exports.debugLog = debugLog;
const errorLog = (...strings) => {
    const string = strings.join(" "); // Join with space for readability
    console.log(string);
};
exports.errorLog = errorLog;
// Function to fetch and load .env variables
async function loadEnvFromUrl(envUrl) {
    try {
        // Fetch the .env file content from the provided URL
        const response = await (0, node_fetch_1.default)(envUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch .env file: ${response.statusText}`);
        }
        const envFileContent = await response.text();
        // Parse the .env content line by line and load each key-value pair
        const lines = envFileContent.split("\n");
        lines.forEach((line) => {
            // Ignore empty lines and comments (lines starting with '#')
            if (line.trim() && !line.startsWith("#")) {
                // Use a regex to handle key=value pairs, allowing '=' in values
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const key = match[1].trim();
                    const value = match[2].trim();
                    process.env[key] = value; // Set the environment variable
                }
            }
        });
        // Log to confirm
        (0, exports.debugLog)("Environment variables loaded from URL: ");
        for (const [key, value] of Object.entries(process.env)) {
            (0, exports.debugLog)(`${key}: ${value}`);
        }
    }
    catch (error) {
        console.error("Error loading .env file:", error);
    }
}
