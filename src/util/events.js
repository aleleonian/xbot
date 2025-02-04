import { XBotEvents, LOG_LEVELS } from "./constants.js";

let eventEmitter;

function fireLog(logType, data) {
    if (eventEmitter) eventEmitter(XBotEvents.LOG, logType, data);
    else {
        console.log("eventEmitter is not set!")
    }
}

export function fireDebugLog(data) {
    fireLog(LOG_LEVELS.DEBUG, data);
}

export function fireInfoLog(data) {
    fireLog(LOG_LEVELS.INFO, data);
}

export function fireWarnLog(data) {
    fireLog(LOG_LEVELS.WARN, data);
}

export function fireErrorLog(data) {
    fireLog(LOG_LEVELS.ERROR, data);
}

export function setEmitter(emitter) {
    eventEmitter = emitter;
}

export function fireNotification(data) {
    if (eventEmitter) eventEmitter(XBotEvents.NOTIFICATION, data);
    else {
        console.log("eventEmitter is not set!")
    }
}