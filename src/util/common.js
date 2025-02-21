import * as crypto from "crypto";
import fetch from "node-fetch";
import { fireDebugLog } from "./events.js";

export const wait = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const createErrorResponse = (errorMessage) => {
  let responseObj = {};
  responseObj.success = false;
  responseObj.errorMessage = errorMessage;
  return responseObj;
};

export const createSuccessResponse = (data) => {
  let responseObj = {};
  responseObj.success = true;
  if (data) responseObj.data = data;
  return responseObj;
};

export const debugLog = (...strings) => {
  const debugValue = process.env.DEBUG;
  const string = strings.join(" "); // Join with space for readability
  if (debugValue) {
    console.log(string);
  }
};
export const errorLog = (...strings) => {
  const string = strings.join(" "); // Join with space for readability
  console.log(string);
};

export function log(level, ...messages) {
  if (this.logger) {
    this.logger(`[${level.toUpperCase()}]`, ...messages);
  }
  this.emit(XBotEvents.LOG, level, ...messages); // Also emit logs
}
// Function to fetch and load .env variables
export async function loadEnvFromUrl(envUrl) {
  try {
    fireDebugLog("gonna try to read from " + envUrl);

    // Fetch the .env file content from the provided URL
    const response = await fetch(envUrl);

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
    fireDebugLog("process.env->" + JSON.stringify(process.env));
    return true;
  } catch (error) {
    console.error("Error loading .env file:", error);
    return false;
  }
}

export function createHash(inputString) {
  const hash = crypto.createHash("md5");
  hash.update(inputString);
  return hash.digest("hex");
}
