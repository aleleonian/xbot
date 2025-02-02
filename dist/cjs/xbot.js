"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_js_1 = require("./util/common.js");
const cheerio = require("cheerio");
const child_process_1 = require("child_process");
const puppeteer_extra_1 = require("puppeteer-extra");
const puppeteer_extra_plugin_stealth_1 = require("puppeteer-extra-plugin-stealth");
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_stealth_1.default)());
const path_1 = require("path");
const fs_1 = require("fs");
const https_1 = require("https");
// const puppeteerClassic = require("puppeteer");
// const iPhone = KnownDevices["iPhone X"];
// const KnownDevices = puppeteerClassic.KnownDevices;
const BROWSER_OPEN_FAIL = 0;
const exitCodeStrings = ["Could not open browser :(!"];
class XBot {
    constructor() {
        this.storeBookmarks = async () => {
            const bookmarkDivs = await this.page.$$('[data-testid="cellInnerDiv"]');
            (0, common_js_1.debugLog)("bookmarkDivs.length->", bookmarkDivs.length);
            if (bookmarkDivs.length == 0)
                return -1;
            const htmlContentDivs = [];
            for (const divHandle of bookmarkDivs) {
                // Get the HTML content of the div
                const htmlContent = await divHandle.evaluate((div) => div.outerHTML);
                htmlContentDivs.push(htmlContent);
            }
            let processedBookmarks = htmlContentDivs
                .map((div) => {
                // if div is the last bookmark, do not include it
                const $ = cheerio.load(div);
                const divWithTestId = $('div[data-testid="cellInnerDiv"]');
                const isLastBookmark = divWithTestId.children(".css-175oi2r.r-4d76ec").length > 0;
                if (isLastBookmark) {
                    return null;
                }
                const divItem = {};
                divItem.htmlContent = div;
                divItem.indexId = this.getId(div);
                return divItem;
            })
                .filter((item) => item !== null);
            for (const newBookmark of processedBookmarks) {
                const $ = cheerio.load(newBookmark.htmlContent);
                const newBookmarkTweetUrl = $('[data-testid="User-Name"] a')
                    .eq(2)
                    .attr("href");
                this.sendMessageToMainWindow("CHECK_SAVED_TWEET_EXISTS", newBookmarkTweetUrl);
                (0, common_js_1.debugLog)("gonna wait for waitForNewReport()");
                const waitForNewReportResponse = await this.waitForNewReport();
                (0, common_js_1.debugLog)(process.env.DEBUG, "waitForNewReportResponse->", JSON.stringify(waitForNewReportResponse));
                if (waitForNewReportResponse.success) {
                    (0, common_js_1.debugLog)(process.env.DEBUG, waitForNewReportResponse.tweetUrl + " already exists, skipping!");
                    continue;
                }
                // have we processed this bookmark already?
                const idExists = this.bookmarks.some((bookmark) => bookmark.indexId === newBookmark.indexId);
                if (!idExists) {
                    (0, common_js_1.debugLog)("We do have to store this bookmark");
                    newBookmark.tweetUrlHash = (0, common_js_1.createHash)(newBookmarkTweetUrl);
                    this.bookmarks.push(newBookmark);
                    if (this.downloadMedia) {
                        (0, common_js_1.debugLog)("We do have to download images!");
                        const videoPlayerDiv = $('div[data-testid="videoPlayer"]');
                        const imageDiv = $('div[data-testid="tweetPhoto"]');
                        if (videoPlayerDiv.length > 0) {
                            newBookmark.hasLocalMedia = "video";
                            const videoPageUrl = "https://x.com" +
                                $('[data-testid="User-Name"] a').eq(2).attr("href");
                            (0, common_js_1.debugLog)(process.env.DEBUG, "Gotta download the video at: ", videoPageUrl);
                            const fetchVideoResult = await this.fetchAndSaveVideo(videoPageUrl, process.env.MEDIA_FOLDER, newBookmark.tweetUrlHash + ".mp4");
                            if (!fetchVideoResult.success) {
                                newBookmark.hasLocalMedia = "no";
                                this.sendMessageToMainWindow("NOTIFICATION", `error--Trouble with fetchAndSaveVideo(): ${fetchVideoResult.errorMessage}`);
                            }
                        }
                        else if (imageDiv.length > 0) {
                            newBookmark.hasLocalMedia = "image";
                            const tweetPhothUrl = $('[data-testid="tweetPhoto"] img').attr("src");
                            (0, common_js_1.debugLog)(process.env.DEBUG, "Gotta download this pic: ", tweetPhothUrl);
                            const fecthImageResult = await this.fetchAndSaveImage(tweetPhothUrl, process.env.MEDIA_FOLDER, newBookmark.tweetUrlHash + ".jpg");
                            if (!fecthImageResult.success) {
                                this.sendMessageToMainWindow("NOTIFICATION", `error--Trouble with fetchAndSaveImage(): ${fecthImageResult.errorMessage}`);
                                newBookmark.hasLocalMedia = "no";
                            }
                        }
                    }
                    else {
                        (0, common_js_1.debugLog)(process.env.DEBUG, "We do NOT have to download images!");
                    }
                    // TODO: on HOLD
                    // const takeSnapshotOfBookmarkResponse =
                    //   await this.takeSnapshotOfBookmark(newBookmark.indexId);
                    // debugLog(
                    //   "takeSnapshotOfBookmarkResponse->",
                    //   JSON.stringify(takeSnapshotOfBookmarkResponse)
                    // );
                    // not sure about this
                    // if (takeSnapshotOfBookmarkResponse.success) {
                    //   sendMessageToMainWindow("SNAPSHOT_TAKEN");
                    // }
                    (0, common_js_1.debugLog)(process.env.DEBUG, "newBookmark.indexId->", newBookmark.indexId);
                }
                else
                    (0, common_js_1.debugLog)(process.env.DEBUG, "we do not need to store bookmark with id:", newBookmark.indexId);
            }
            return this.bookmarks.length;
        };
        this.scrapeBookmarks = async () => {
            this.keepScraping = true;
            let bookmarksCopy = [];
            let scrollPosition = 0;
            while (this.keepScraping) {
                this.showProgressFunction();
                let howManyStoredBookmarks = await this.storeBookmarks();
                (0, common_js_1.debugLog)("howManyStoredBookmarks->", howManyStoredBookmarks);
                if (howManyStoredBookmarks == -1)
                    break;
                //TODO: this is flawed because if i have 500 bookmarks but the last 5 were already saved, i'd be breaking
                // without further analysis, which is wrong.
                // if (howManyStoredBookmarks < 1) break;
                if (howManyStoredBookmarks > 0)
                    bookmarksCopy = bookmarksCopy.concat(this.bookmarks);
                this.bookmarks = [];
                if (this.deleteOnlineBookmarks) {
                    const deleteTwitterBookmarks2Response = await this.deleteTwitterBookmarks2();
                    (0, common_js_1.debugLog)("deleteTwitterBookmarks2Response->", JSON.stringify(deleteTwitterBookmarks2Response));
                }
                else {
                    (0, common_js_1.debugLog)("Gonna scroll...");
                    await this.page.evaluate(() => {
                        window.scrollBy(0, window.innerHeight);
                    });
                    // Wait for a while after each scroll to give time for content loading
                    await this.wait(3000);
                    howManyStoredBookmarks = await this.storeBookmarks();
                    // if (howManyStoredBookmarks < 1) break;
                    if (howManyStoredBookmarks == -1)
                        break;
                    if (howManyStoredBookmarks > 0)
                        bookmarksCopy = bookmarksCopy.concat(this.bookmarks);
                    this.bookmarks = [];
                    (0, common_js_1.debugLog)("bookmarks stored.");
                    // Get the scroll position
                    const newScrollPosition = await this.page.evaluate(() => {
                        return window.scrollY;
                    });
                    if (newScrollPosition > scrollPosition) {
                        (0, common_js_1.debugLog)("looping again.");
                        scrollPosition = newScrollPosition;
                    }
                    else if (newScrollPosition <= scrollPosition) {
                        (0, common_js_1.debugLog)("End of page reached. Stopping.");
                        break;
                    }
                }
            }
            return bookmarksCopy;
        };
        this.isScrolledToBottom = async () => {
            const result = await this.page.evaluate(() => {
                const scrollTop = document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;
                return Math.ceil(scrollTop + clientHeight) >= scrollHeight;
            });
            return result;
        };
        this.browser;
        this.page;
        this.tweets = {};
        this.isLoggedIn = false;
        this.isBusy = false;
        this.queue = [];
        this.queueTimer = false;
        this.monitorFlag = true;
        this.bookmarks = [];
        this.keepScraping = true;
        this.botUsername;
        this.botPassword;
        this.botEmail;
        this.downloadMedia;
        this.deleteOnlineBookmarks;
    }
    async fetchAndSaveImage(imageUrl, saveDir, saveFileName) {
        return new Promise((resolve) => {
            try {
                // Path to save the image
                const savePath = path_1.default.join(saveDir, saveFileName);
                // Download and save the image
                const file = fs_1.default.createWriteStream(savePath);
                https_1.default
                    .get(imageUrl, (response) => {
                    if (response.statusCode === 200) {
                        response.pipe(file);
                        file.on("finish", () => {
                            file.close();
                            (0, common_js_1.debugLog)(process.env.DEBUG, `Image saved to ${savePath}`);
                            resolve((0, common_js_1.createSuccessResponse)());
                        });
                    }
                    else {
                        const errorMessage = `Failed to fetch image. Status code: ${response.statusCode}`;
                        (0, common_js_1.debugLog)(errorMessage);
                        resolve((0, common_js_1.createErrorResponse)(errorMessage));
                    }
                })
                    .on("error", (err) => {
                    const errorMessage = `Error fetching the image: ${err.message}`;
                    (0, common_js_1.errorLog)(errorMessage);
                    resolve((0, common_js_1.createErrorResponse)(errorMessage));
                });
            }
            catch (error) {
                const errorMessage = `Error fetching the image: ${error.message}`;
                (0, common_js_1.errorLog)(errorMessage);
                resolve((0, common_js_1.createErrorResponse)(errorMessage));
            }
        });
    }
    async fetchAndSaveVideo(videoPageurl, saveDir, saveFileName) {
        return new Promise((resolve) => {
            try {
                const command = `${process.env.YTDLP_INSTALLATION} --ffmpeg-location ${process.env.FFMPEG_INSTALLATION} -o "${saveDir}/${saveFileName}" ${videoPageurl}`;
                (0, child_process_1.exec)(command, (error, stdout, stderr) => {
                    if (error) {
                        (0, common_js_1.errorLog)(`Error executing yt-dlp: ${error.message}`);
                        resolve((0, common_js_1.createErrorResponse)(error.message));
                        return;
                    }
                    if (stderr) {
                        (0, common_js_1.errorLog)(`stderr: ${stderr}`);
                        resolve((0, common_js_1.createErrorResponse)(stderr));
                        return;
                    }
                    (0, common_js_1.debugLog)(`stdout: ${stdout}`);
                    resolve((0, common_js_1.createSuccessResponse)(stdout));
                });
            }
            catch (error) {
                (0, common_js_1.errorLog)(`fetchAndSaveVideo: Error occurred: ${error.message}`);
                resolve((0, common_js_1.createErrorResponse)(error.message));
            }
        });
    }
    getId(divHtmlContent) {
        const $ = cheerio.load(divHtmlContent);
        // Get the style attribute value of #mainDiv
        const mainDivStyle = $('[data-testid="cellInnerDiv"]').attr("style");
        const translateYRegex = /translateY\(([-\d.]+)px\)/;
        // Match the translateY value using the regex
        const match = mainDivStyle.match(translateYRegex);
        // Extract the translateY value if a match is found
        let translateYValue = null;
        if (match && match.length > 1) {
            translateYValue = match[1];
        }
        return translateYValue
            ? translateYValue
            : (0, common_js_1.createHash)(divHtmlContent);
    }
    setBusy(state) {
        this.isBusy = state;
        return true;
    }
    getTweet(userId) {
        return this.tweets[userId];
    }
    async init(showProgressFunction, sendMessageToMainWindow, waitForNewReport) {
        this.showProgressFunction = showProgressFunction;
        this.sendMessageToMainWindow = sendMessageToMainWindow;
        this.waitForNewReport = waitForNewReport;
        let pupConfig = {
            headless: process.env.XBOT_HEADLESS === "true",
            ignoreDefaultArgs: ["--enable-automation"],
            args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
        };
        if (process.env.EXECUTABLE_PATH) {
            pupConfig.executablePath = process.env.EXECUTABLE_PATH;
        }
        const browser = await puppeteer_extra_1.default.launch(pupConfig);
        let responseObject = {};
        if (!browser) {
            responseObject = {
                success: false,
                exitCode: BROWSER_OPEN_FAIL,
                message: exitCodeStrings[BROWSER_OPEN_FAIL],
            };
            return responseObject;
        }
        else {
            this.browser = browser;
            responseObject = {
                success: true,
            };
            this.page = await browser.newPage();
            this.page.setDefaultTimeout(10000);
            return responseObject;
        }
    }
    async goto(urlToVisit) {
        try {
            await this.page.goto(urlToVisit, {
                waitUntil: "load",
            });
            return true;
        }
        catch (error) {
            (0, common_js_1.debugLog)("goto: Error! ", error);
            return false;
        }
    }
    async takePic(filePath) {
        if (!filePath) {
            filePath = path_1.default.resolve(__dirname, "../public/images/xBotSnap.jpg");
        }
        try {
            await this.page.screenshot({ path: filePath });
            return true;
        }
        catch (error) {
            (0, common_js_1.debugLog)("takePic() error->", error);
            return false;
        }
    }
    async findAndType(targetElement, text) {
        try {
            let inputElement = await this.page.waitForSelector(targetElement);
            await inputElement.type(text);
            return true;
        }
        catch (error) {
            (0, common_js_1.debugLog)("findAndType: Error! ", error);
            return false;
        }
    }
    async findAndClick(targetElement) {
        try {
            let inputElement = await this.page.waitForSelector(targetElement);
            await inputElement.click();
            return true;
        }
        catch (error) {
            (0, common_js_1.debugLog)("findAndClick: Error! ", error);
            return false;
        }
    }
    async findElement(targetElement, timeoutMs = 30000) {
        try {
            await this.page.waitForSelector(targetElement, { timeout: timeoutMs });
            return true;
        }
        catch (error) {
            (0, common_js_1.debugLog)("findElement: Error! ", error);
            return false;
        }
    }
    async findAndGetText(targetElement) {
        try {
            await this.page.waitForSelector(targetElement);
            const text = await this.page.$eval(targetElement, (el) => el.innerText);
            let responseObject = {};
            responseObject.success = true;
            responseObject.text = text;
            return responseObject;
        }
        catch (error) {
            (0, common_js_1.debugLog)("findAndGetText: Error! ", error);
            return false;
        }
    }
    getCurrentBotUrl() {
        return this.page.url();
    }
    async findTextInPage(targetText) {
        const found = await this.page.evaluate((targetText) => {
            return document.body.innerText
                .toLowerCase()
                .includes(targetText.toLowerCase());
        }, targetText);
        (0, common_js_1.debugLog)(targetText + " was found: " + found);
        return found;
    }
    async findTextInFrame(iFrame, targetText) {
        const found = await iFrame.evaluate(() => {
            return document.body.innerText.includes("your desired text");
        }, targetText);
        (0, common_js_1.debugLog)(targetText + " was found: " + found);
        return found;
    }
    async getLastTweetUrl() {
        let hasVisited = await this.goto("https://www.x.com" + "/" + this.botUsername);
        if (!hasVisited)
            return false;
        let foundAndClicked = await this.findAndClick(process.env.TWITTER_LAST_POST_IN_PROFILE);
        if (!foundAndClicked)
            return false;
        return this.getCurrentBotUrl();
    }
    async tweet(userId, text) {
        // if the xBot is busy then the userId and tweetText will be kept in an object in
        // the queue array
        // if the queue array's length == 1, then the queue monitor will be turned on
        // the queue monitor is a function that checks every 5 seconds whether the xBot is
        // still busy or not
        // when it finds the xBot to not be busy, then it pops the next item from the queue
        // and tweets it
        // if the queue is empty, then the queue monitor turns itself off
        (0, common_js_1.debugLog)("userId->", userId);
        (0, common_js_1.debugLog)("text->", text);
        if (!this.isBusy) {
            (0, common_js_1.debugLog)("this.isBusy->", this.isBusy);
            this.isBusy = true;
            let hasVisited = await this.goto("https://www.x.com");
            if (!hasVisited)
                return this.respond(false, "Could not visit x.com");
            (0, common_js_1.debugLog)("tweet() visited x.com");
            // TODO: if the TWITTER_NEW_TWEET_INPUT is not found it's because Twitter
            // suspects i'm a bot and wants my email
            let foundAndClicked = await this.findAndClick(process.env.TWITTER_NEW_TWEET_INPUT);
            if (!foundAndClicked)
                return this.respond(false, "Could not find TWITTER_NEW_TWEET_INPUT");
            (0, common_js_1.debugLog)(process.env.DEBUG, "tweet() found and clicked TWITTER_NEW_TWEET_INPUT");
            let foundAndTyped = await this.findAndType(process.env.TWITTER_NEW_TWEET_INPUT, text);
            if (!foundAndTyped)
                return this.respond(false, "Could not find and type TWITTER_NEW_TWEET_INPUT");
            (0, common_js_1.debugLog)(process.env.DEBUG, "tweet() found and typed TWITTER_NEW_TWEET_INPUT");
            foundAndClicked = await this.findAndClick(process.env.TWITTER_POST_BUTTON);
            if (!foundAndClicked)
                return this.respond(false, "Could not find and click TWITTER_POST_BUTTON");
            (0, common_js_1.debugLog)(process.env.DEBUG, "tweet() found and clicked TWITTER_POST_BUTTON");
            //TODO: scan the page for "Whoops! you posted that already"
            this.isBusy = false;
            this.tweets[userId] = text;
            return this.respond(true, "xBot tweeted!");
        }
        else {
            (0, common_js_1.debugLog)("xBot is busy, queuing task.");
            this.queue.push({ userId, text });
            if (this.queue.length == 1) {
                (0, common_js_1.debugLog)("starting queue monitor");
                this.startQueueMonitor();
            }
            return this.respond(false, "xBot is busy");
        }
    }
    async twitterSuspects() {
        try {
            const TwitterSuspects = await this.page.waitForSelector(`//*[contains(text(), '${process.env.SUSPICION_TEXT}')]`, { timeout: 10000 });
            if (TwitterSuspects) {
                (0, common_js_1.debugLog)("Found SUSPICION_TEXT!");
                return true;
            }
            else {
                (0, common_js_1.debugLog)("Did NOT find SUSPICION_TEXT!");
                return false;
            }
        }
        catch (error) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "twitterSuspects() exception! -> Did NOT find SUSPICION_TEXT! : ", error);
            return false;
        }
    }
    async twitterRequiresCaptcha() {
        try {
            const TwitterSuspects = await this.page.waitForSelector(`//*[contains(text(), '${process.env.TWITTER_AUTHENTICATE_TEXT}')]`, { timeout: 5000 });
            if (TwitterSuspects) {
                (0, common_js_1.debugLog)("Found TWITTER_AUTHENTICATE_TEXT!");
                return true;
            }
            else {
                (0, common_js_1.debugLog)(process.env.DEBUG, "Did NOT find TWITTER_AUTHENTICATE_TEXT!");
                return false;
            }
        }
        catch (error) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "twitterRequiresCaptcha() exception! -> Did NOT find TWITTER_AUTHENTICATE_TEXT! ", error);
            return false;
        }
    }
    async unusualLoginDetected() {
        try {
            return await this.findTextInPage(process.env.TWITTER_UNUSUAL_LOGIN_TEXT);
        }
        catch (error) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "unusualLoginDetected() exception! -> Did NOT find TWITTER_UNUSUAL_LOGIN_TEXT!");
            (0, common_js_1.debugLog)(error);
            return false;
        }
    }
    async arkoseChallengeDetected() {
        const arkoseFrame = await this.page.$("#arkoseFrame");
        if (arkoseFrame) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "arkoseFrame exists! we need you to do stuff");
            return true;
        }
        else {
            (0, common_js_1.debugLog)(process.env.DEBUG, "Bro the arkoseFrame div DOES NOT exists bro!");
        }
    }
    async twitterWantsVerification() {
        try {
            const TwitterWantsToVerify = await this.page.waitForSelector(`//*[contains(text(), '${process.env.VERIFICATION_TEXT}')]`, { timeout: 3000 });
            if (TwitterWantsToVerify) {
                (0, common_js_1.debugLog)("Alert: found VERIFICATION_TEXT!!");
                const pageContent = await this.page.content();
                let response = {};
                response.success = true;
                response.pageContent = pageContent;
                return response;
            }
            else {
                (0, common_js_1.debugLog)("Did NOT find VERIFICATION_TEXT!");
                let response = {};
                response.success = false;
                return response;
            }
        }
        catch (error) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "twitterSuspects() exception! -> Did NOT find VERIFICATION_TEXT!", error);
            return false;
        }
    }
    async closeBrowser() {
        return await this.browser.close();
    }
    async lookForWrongLoginInfoDialog(textToLookFor) {
        try {
            const timeout = 5000;
            const pollInterval = 200;
            const dialogAppeared = await new Promise((resolve) => {
                const startTime = Date.now();
                const interval = setInterval(async () => {
                    const findTextInPageResult = await this.findTextInPage(textToLookFor);
                    if (findTextInPageResult) {
                        clearInterval(interval);
                        resolve(true);
                    }
                    if (Date.now() - startTime > timeout) {
                        clearInterval(interval);
                        resolve(false);
                    }
                }, pollInterval);
            });
            if (dialogAppeared) {
                (0, common_js_1.debugLog)("Error dialog detected.");
                return true;
            }
            else {
                (0, common_js_1.debugLog)(process.env.DEBUG, "Error dialog did not appear within the timeout.");
                return false;
            }
        }
        catch (error) {
            (0, common_js_1.errorLog)("An error occurred:", error);
            return false;
        }
    }
    async logOut() {
        await this.goto("https://x.com/logout");
        let foundAndClicked = await this.findAndClick(process.env.TWITTER_LOGOUT_BUTTON);
        if (!foundAndClicked) {
            (0, common_js_1.debugLog)("Cant't find TWITTER_LOGOUT_BUTTON");
            return false;
        }
        (0, common_js_1.debugLog)("Found TWITTER_LOGOUT_BUTTON");
        this.isLoggedIn = false;
        return true;
    }
    async loginToX(botUsername, botPassword, botEmail) {
        this.isBusy = true;
        if (!this.isLoggedIn) {
            let hasVisited = await this.goto("https://www.x.com/login");
            if (!hasVisited) {
                (0, common_js_1.debugLog)("Can't visit https://www.x.com");
                this.isBusy = false;
                return this.respond(false, "Could not visit x.com");
            }
            (0, common_js_1.debugLog)("We're at https://www.x.com");
            let foundAndClicked = await this.findAndClick(process.env.TWITTER_USERNAME_INPUT);
            if (!foundAndClicked) {
                (0, common_js_1.debugLog)("Can't find TWITTER_USERNAME_INPUT");
                (0, common_js_1.debugLog)("TWITTER_USERNAME_INPUT->", process.env.TWITTER_USERNAME_INPUT);
                this.isBusy = false;
                return this.respond(false, "Can't find TWITTER_USERNAME_INPUT");
            }
            (0, common_js_1.debugLog)(process.env.DEBUG, "Found and clicked TWITTER_USERNAME_INPUT");
            let foundAndTyped = await this.findAndType(process.env.TWITTER_USERNAME_INPUT, botUsername);
            if (!foundAndTyped) {
                (0, common_js_1.debugLog)(process.env.DEBUG, "Can't find and type TWITTER_USERNAME_INPUT");
                this.isBusy = false;
                return this.respond(false, "Can't find and type TWITTER_USERNAME_INPUT");
            }
            (0, common_js_1.debugLog)(process.env.DEBUG, "Found and typed TWITTER_USERNAME_INPUT");
            foundAndClicked = await this.findAndClick(process.env.TWITTER_USERNAME_SUBMIT_BUTTON);
            if (!foundAndClicked) {
                (0, common_js_1.debugLog)(process.env.DEBUG, "Can't find and click TWITTER_USERNAME_SUBMIT_BUTTON");
                this.isBusy = false;
                return this.respond(false, "Can't find and click TWITTER_USERNAME_SUBMIT_BUTTON");
            }
            (0, common_js_1.debugLog)(process.env.DEBUG, "Found and clicked TWITTER_USERNAME_SUBMIT_BUTTON");
            if (await this.lookForWrongLoginInfoDialog("we could not find your account")) {
                return this.respond(false, "Bro, your username is fucked up.");
            }
            foundAndClicked = await this.findAndClick(process.env.TWITTER_PASSWORD_INPUT);
            if (!foundAndClicked) {
                (0, common_js_1.debugLog)(process.env.DEBUG, "Can't find and click TWITTER_PASSWORD_INPUT");
                // let's look for this text We need to make sure that you’re a real person.
                // await this.wait(300000)
                if (await this.twitterRequiresCaptcha()) {
                    (0, common_js_1.debugLog)(process.env.DEBUG, "Bro, you need to solve the puzzle!");
                }
                else if (await this.unusualLoginDetected()) {
                    (0, common_js_1.debugLog)(process.env.DEBUG, "Bro, X detected an unusual login attempt! Will try to calm the bitch down.");
                    // await this.wait(15000);
                    try {
                        await this.findAndType(process.env.TWITTER_UNUSUAL_LOGIN_EMAIL_INPUT, botEmail);
                        //TODO what if findAndTypeResult is false?
                        await this.findAndClick(process.env.TWITTER_UNUSUAL_LOGIN_SUBMIT_BUTTON);
                        //TODO this is not being found despite apparently having to be the case
                        //when my login data is bullshit
                        //TODO implement a web server to live debug wtf is going on the
                        //remote chrome
                        if (await this.lookForWrongLoginInfoDialog("please try again")) {
                            return this.respond(false, "Bro, your password is messed up.");
                        }
                    }
                    catch (error) {
                        (0, common_js_1.debugLog)(error);
                        this.isBusy = false;
                        return this.respond(false, "Could not go past unusual login attempt!");
                    }
                    // click TWITTER_UNUSUAL_LOGIN_SUBMIT_BUTTON
                }
                else if (await this.arkoseChallengeDetected()) {
                    //TODO: instead of waiting 20 seconds, i should make a button appear on the main
                    //screen that reads 'continue' and you solve the captcha and then click it and then
                    //scraping resumes.
                    // a button should show up in the main screen
                    // this function should enter an indefinite loop that only breaks
                    // when some external condition changes
                    // that external condition would be changed by the clicking of that button
                    (0, common_js_1.debugLog)(process.env.DEBUG, "Bro we need you to do something about this situation, will give you 20 seconds.");
                    await this.wait(20000);
                }
                else {
                    (0, common_js_1.debugLog)(process.env.DEBUG, "Bro, we're defeated by Twitter. Dang it.");
                    this.isBusy = false;
                    return this.respond(false, "Can't find and click TWITTER_PASSWORD_INPUT");
                }
            }
            else
                (0, common_js_1.debugLog)(process.env.DEBUG, "Found and clicked TWITTER_PASSWORD_INPUT");
            foundAndTyped = await this.findAndType(process.env.TWITTER_PASSWORD_INPUT, botPassword);
            if (!foundAndTyped) {
                (0, common_js_1.debugLog)(process.env.DEBUG, "Can't find and type TWITTER_PASSWORD_INPUT");
                this.isBusy = false;
                return this.respond(false, "Can't find and type TWITTER_PASSWORD_INPUT");
            }
            (0, common_js_1.debugLog)(process.env.DEBUG, "Found and typed TWITTER_PASSWORD_INPUT");
            await this.page.keyboard.press("Enter");
            await this.wait(3000);
            if (await this.lookForWrongLoginInfoDialog("wrong password")) {
                return this.respond(false, "Bro, your password is messed up.");
            }
            // const wrongPassword = await this.findTextInPage("wrong password");
            // debugLog(process.env.DEBUG,"wrongPassword->", wrongPassword);
            // if (wrongPassword) {
            //     return this.respond(false, "Your password is bad.");
            // }
            const blockedAttempt = await this.findTextInPage("We blocked an attempt to access your account because");
            if (blockedAttempt) {
                return this.respond(false, "We're temporarily blocked for some reason.");
            }
            //TODO gotta check for In order to protect your account from suspicious activity
            this.isLoggedIn = true;
            this.isBusy = false;
            return this.respond(true, "xBot is logged in!");
            // TODO: i think this is outdated
            //HERE I GOTTA MAKE SURE I PROPERLY LOGGED IN
            // check for Suspicious login prevented
            // const found = await this.findElement(process.env.TWITTER_PASSWORD_INPUT, 5000);
            // if (found) {
            //     debugLog(process.env.DEBUG,"Found TWITTER_PASSWORD_INPUT when i should not, wrong login data assumed.");
            //     this.isBusy = false;
            //     return this.respond(false, "Wrong login information.");
            // }
            //HERE I GOTTA MAKE SURE Twitter is not suspicious and temporarily blocked me
            // debugLog(process.env.DEBUG,"Twitter Bot has logged in, we now will try to detect suspicion.");
            // let confirmedSuspicion = await this.twitterSuspects();
            // if (confirmedSuspicion) {
            //     debugLog(process.env.DEBUG,"Twitter suspects, will try to convince them.");
            //     let emailWasInput = await this.inputEmail();
            //     if (emailWasInput) {
            //         debugLog(process.env.DEBUG,"We succeeded convincing twitter. We're in.");
            //         this.isBusy = false;
            //         return this.respond(true, "xBot is logged in, we convinced Elon!");
            //     }
            //     else {
            //         debugLog(process.env.DEBUG,"We did not convince Elon :(");
            //         this.isBusy = false;
            //         return this.respond(false, "xBot is not logged in :(");
            //     }
            // }
            // else {
            //     debugLog(process.env.DEBUG,"We will now try to see if Twitter wants verification from us.")
            //     let confirmedVerification = await this.twitterWantsVerification();
            //     if (confirmedVerification.success) {
            //         debugLog(process.env.DEBUG,"Twitter wants verification from us!")
            //         // now we must check the code that was sent to us
            //         // (or read the email automatically)
            //         // and send it to the browser.
            //         // The thing is i don't know how to locate that input field yet.
            //         this.isBusy = false;
            //         return this.respond(false, "Bot did NOT log in / Twitter wants verification code.")
            //         // res.download(filePath);
            //     }
            //     else {
            //         debugLog(process.env.DEBUG,"Apparently Twitter does not suspect, so we're logged in!");
            //         this.isLoggedIn = true;
            //         this.isBusy = false;
            //         return this.respond(true, "xBot is logged in!")
            //     }
            // }
        }
        else {
            (0, common_js_1.debugLog)("xBot is already logged in!");
            this.isBusy = false;
            return this.respond(false, "xBot is already logged in!");
        }
    }
    async inputEmail() {
        let foundAndClicked = await this.findAndClick(process.env.TWITTER_EMAIL_INPUT);
        if (!foundAndClicked) {
            (0, common_js_1.debugLog)("Cant't find TWITTER_EMAIL_INPUT");
            return false;
        }
        (0, common_js_1.debugLog)("Found TWITTER_EMAIL_INPUT");
        let foundAndTyped = await this.findAndType(process.env.TWITTER_EMAIL_INPUT, this.botEmail);
        if (!foundAndTyped) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "Can't find and type TWITTER_EMAIL_INPUT");
            return false;
        }
        (0, common_js_1.debugLog)("Found and typed TWITTER_EMAIL_INPUT");
        await this.page.keyboard.press("Enter");
        return true;
    }
    async inputVerificationCode(code) {
        let foundAndClicked = await this.findAndClick(process.env.TWITTER_VERIFICATION_CODE_INPUT);
        if (!foundAndClicked) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "Cant't find TWITTER_VERIFICATION_CODE_INPUT");
            return false;
        }
        (0, common_js_1.debugLog)("Found TWITTER_VERIFICATION_CODE_INPUT");
        let foundAndTyped = await this.findAndType(process.env.TWITTER_VERIFICATION_CODE_INPUT, code);
        if (!foundAndTyped) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "Can't find and type TWITTER_VERIFICATION_CODE_INPUT");
            return false;
        }
        (0, common_js_1.debugLog)(process.env.DEBUG, "Found and typed TWITTER_VERIFICATION_CODE_INPUT");
        await this.page.keyboard.press("Enter");
        return true;
    }
    respond(success, message, data) {
        let responseObj = {};
        responseObj.success = success;
        responseObj.message = message;
        if (data) {
            responseObj.data = data;
        }
        return responseObj;
    }
    startQueueMonitor() {
        this.queueTimer = setInterval(() => this.processQueue(this), 5000);
    }
    stopQueueMonitor() {
        clearInterval(this.queueTimer);
    }
    async processQueue(xBotClassContext) {
        if (!xBotClassContext.isBusy) {
            (0, common_js_1.debugLog)(process.env.DEBUG, "xBotClassContext.isBusy->" + xBotClassContext.isBusy);
            (0, common_js_1.debugLog)(process.env.DEBUG, "xBot is not busy, so processQueue will start completing pending tasks");
            while (xBotClassContext.queue.length > 0) {
                const nextItem = xBotClassContext.queue.pop();
                (0, common_js_1.debugLog)(process.env.DEBUG, "nextItem->", JSON.stringify(nextItem));
                await xBotClassContext.tweet(nextItem.userId, nextItem.text);
                //wait some time
            }
            xBotClassContext.stopQueueMonitor();
        }
        else
            return;
    }
    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async takeSnapshotOfBookmark(indexId) {
        try {
            // Construct the selector dynamically using the indexId
            const selector = `div[data-testid="cellInnerDiv"][style*="transform: translateY(${indexId}px)"]`;
            // Get the element handle of the target div
            const elementHandle = await this.page.$(selector);
            if (elementHandle) {
                const boundingBox = await elementHandle.boundingBox();
                if (boundingBox) {
                    const screenshotPath = `${process.env.MEDIA_FOLDER}/bookmark-screenshot.png`;
                    await this.page.screenshot({
                        path: screenshotPath,
                        clip: {
                            x: boundingBox.x,
                            y: boundingBox.y,
                            width: boundingBox.width,
                            height: boundingBox.height,
                        },
                    });
                    (0, common_js_1.debugLog)(`Screenshot saved at ${screenshotPath}`);
                    return { success: true, path: screenshotPath };
                }
                else {
                    console.error("Bounding box not found for the element.");
                    return { success: false, error: "Bounding box not found." };
                }
            }
            else {
                console.error("Element not found.");
                return { success: false, error: "Element not found." };
            }
        }
        catch (error) {
            console.error(`Error taking snapshot: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
    async deleteTwitterBookmarks2() {
        const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve((0, common_js_1.createErrorResponse)("Function timed out")), ms));
        return Promise.race([
            this.deleteTwitterBookmarks2Core(),
            timeout(5 * 60 * 1000), // 5 minutes
        ]);
    }
    async deleteTwitterBookmarks2Core() {
        (0, common_js_1.debugLog)("deleteTwitterBookmarks2() started");
        try {
            // Usage
            const handles = await this.withTimeout("cellInnerDiv", this.page.$$('[data-testid="cellInnerDiv"]'), 10000 // 10 seconds
            );
            (0, common_js_1.debugLog)("cellInnerDiv handles.length->", handles.length);
            for (const handle of handles) {
                const buttonHandles = await this.withTimeout("bookmarkButton", await handle.$$('[role="button"][aria-label][class="css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l"]'), 10000);
                if (buttonHandles.length > 0) {
                    let matchingParentHandle = null;
                    let savedTweetHtml = "";
                    for (const buttonHandle of buttonHandles) {
                        const hasMatchingChild = await buttonHandle.evaluate((parent) => {
                            // Check if this is the div that holds the 'bookmarked' button
                            const path = parent.querySelector('path[d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"]');
                            return path !== null;
                        });
                        if (hasMatchingChild) {
                            matchingParentHandle = buttonHandle;
                            break;
                        }
                    }
                    if (matchingParentHandle) {
                        (0, common_js_1.debugLog)("Gonna click the bookmarked button");
                        await matchingParentHandle.click();
                    }
                    else {
                        (0, common_js_1.debugLog)("No matching parent handle found.");
                    }
                }
                else {
                    (0, common_js_1.debugLog)("Less than 1 button found in this cellInnerDiv");
                }
            }
            (0, common_js_1.debugLog)("deleteTwitterBookmarks2() finished");
            return (0, common_js_1.createSuccessResponse)();
        }
        catch (error) {
            return (0, common_js_1.createErrorResponse)(error);
        }
    }
    async deleteTwitterBookmarks() {
        await this.page.waitForSelector('[aria-label="Bookmarked"]');
        //TODO: Bookmarked is in english, but it could be another language
        // Get all buttons with the `aria-label="Bookmarked"`
        let bookmarkButtons = await this.page.$$('[aria-label="Bookmarked"]');
        // while (bookmarkButtons.length > 0) {
        (0, common_js_1.debugLog)(`Found ${bookmarkButtons.length} bookmark buttons.`);
        // Function to delay execution for a specified time
        // Loop through the buttons and click them with a 2-second delay
        for (let i = 0; i < bookmarkButtons.length; i++) {
            try {
                await bookmarkButtons[i].click();
                (0, common_js_1.debugLog)(`Clicked button ${i + 1}`);
            }
            catch (error) {
                (0, common_js_1.errorLog)(`Error clicking button ${i + 1}:`, error);
            }
            // Delay for 2 seconds
            await this.wait(1000);
        }
        //   bookmarkButtons = await this.page.$$('[aria-label="Bookmarked"]');
        // }
        (0, common_js_1.debugLog)("Finished clicking all bookmark buttons.");
    }
    async withTimeout(id, promise, ms) {
        const errorMessage = id + " operation timed out";
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms));
        return Promise.race([promise, timeout]);
    }
}
exports.default = XBot;
//# sourceMappingURL=xbot.js.map