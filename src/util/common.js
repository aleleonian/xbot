import * as crypto from "crypto";
import fetch from "node-fetch";
import { fireDebugLog, fireErrorLog } from "./events";
import * as fs from 'fs/promises';

export async function deleteFolder(folderPath) {
  try {
    await fs.rm(folderPath, { recursive: true, force: true });
    console.log('Folder removed successfully.');
  } catch (err) {
    fireErrorLog("deleteFolder() error: " + err);
  }
}


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
