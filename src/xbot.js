import {
  createErrorResponse,
  createHash,
  createSuccessResponse,
  loadEnvFromUrl,
} from "./util/common.js";
import {
  setEmitter,
  fireDebugLog,
  fireErrorLog,
  fireWarnLog,
  fireInfoLog,
  fireNotification,
} from "./util/events.js";

import { XBotEvents } from "./util/constants.js";

import { promisify } from "util";
const execAsync = promisify(exec);
import * as cheerio from "cheerio";
import { EventEmitter } from "events";
import { exec } from "child_process";
import puppeteer from "puppeteer-extra";
import pluginStealth from "puppeteer-extra-plugin-stealth";
puppeteer.use(pluginStealth());
import path from "path";
import fs from "fs";
import https from "https";

const BROWSER_OPEN_FAIL = 0;
const exitCodeStrings = ["Could not open browser :(!"];

class XBot extends EventEmitter {
  constructor() {
    super();
    setEmitter(this);

    this.browser;
    this.page;
    this.tweets = {};
    this.isLoggedIn = false;
    this.isBusy = false;
    this.queue = [];
    this.queueTimer = false;
    this.bookmarks = [];
    this.keepScraping = true;
    this.botUsername;
    this.botPassword;
    this.botEmail;
    this.downloadMedia;
    this.deleteOnlineBookmarks;
  }

  fetchAndSaveImage(imageUrl, saveDir, saveFileName) {
    return new Promise((resolve) => {
      const savePath = path.join(saveDir, saveFileName);
      // Download and save the image
      const file = fs.createWriteStream(savePath);
      https
        .get(imageUrl, (response) => {
          if (response.statusCode === 200) {
            response.pipe(file);
            file.on("finish", () => {
              file.close();
              fireDebugLog(`Image saved to ${savePath}`);
              resolve(createSuccessResponse());
            });
          } else {
            const errorMessage = `Failed to fetch image. Status code: ${response.statusCode}`;
            fireErrorLog(errorMessage);
            resolve(createErrorResponse(errorMessage));
          }
        })
        .on("error", (err) => {
          const errorMessage = `Error fetching the image: ${err.message}`;
          fireErrorLog(errorMessage);
          resolve(createErrorResponse(errorMessage));
        });
    }).catch((error) => {
      const errorMessage = `Error fetching the image: ${error.message}`;
      fireErrorLog(errorMessage);
      resolve(createErrorResponse(errorMessage));
    });
  }

  async fetchAndSaveVideo(videoPageUrl, saveDir, saveFileName) {
    try {
      const command = `${process.env.YTDLP_INSTALLATION} --ffmpeg-location ${process.env.FFMPEG_INSTALLATION} -o "${saveDir}/${saveFileName}" ${videoPageUrl}`;

      const { stdout, stderr } = await execAsync(command);

      if (stderr) {
        fireErrorLog(`fetchAndSaveVideo() stderr: ${stderr}`);
        resolve(createErrorResponse(stderr));
      }

      fireInfoLog(`✅ Video saved: ${stdout}`);
      return createSuccessResponse(stdout);
    } catch (error) {
      fireErrorLog(`fetchAndSaveVideo error: ${error.message}`);
      return createErrorResponse(error.message);
    }
  }

  getTweetAuthor(divHtmlContent) {
    const tweetPath = this.getTweetUrlPath(divHtmlContent);
    return tweetPath.substring(1, tweetPath.indexOf("/", 1));
  }

  getTweetUrlPath(divHtmlContent) {
    const $ = cheerio.load(divHtmlContent);
    return $(process.env.TWEET_AUTHOR_ANCHOR_SELECTOR).eq(2).attr("href");
  }

  getTweetId(divHtmlContent) {
    const $ = cheerio.load(divHtmlContent);

    // Get the style attribute value of #mainDiv
    const mainDivStyle = $(process.env.TWEET_SELECTOR).attr("style");

    const translateYRegex = /translateY\(([-\d.]+)px\)/;

    // Match the translateY value using the regex
    const match = mainDivStyle.match(translateYRegex);

    // Extract the translateY value if a match is found
    let translateYValue = null;
    if (match && match.length > 1) {
      translateYValue = match[1];
    }
    return translateYValue;
  }

  setBusy(state) {
    this.isBusy = state;
    return true;
  }
  getTweet(userId) {
    return this.tweets[userId];
  }
  async init() {
    process.env.MEDIA_FOLDER ||= "./"; // Ensures a default value is set

    const envUrl = "https://www.latigo.com.ar/savedX/selectors.env"; // Replace with your actual URL

    const loadResult = await loadEnvFromUrl(envUrl);
    if (!loadResult) {
      return createErrorResponse("loadEnvFromUrl() failed");
    }
    let pupConfig = {
      headless: process.env.XBOT_HEADLESS === "true",
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
    };

    if (process.env.EXECUTABLE_PATH) {
      pupConfig.executablePath = process.env.EXECUTABLE_PATH;
    }

    try {
      const browser = await puppeteer.launch(pupConfig);
      let responseObject = {};
      if (!browser) {
        responseObject = {
          success: false,
          exitCode: BROWSER_OPEN_FAIL,
          message: exitCodeStrings[BROWSER_OPEN_FAIL],
        };
        return responseObject;
      } else {
        this.browser = browser;
        responseObject = {
          success: true,
        };
        this.page = await browser.newPage();
        this.page.setDefaultTimeout(20000);
        return responseObject;
      }
    } catch (error) {
      if (this.browser) await this.browser.close();
      fireErrorLog("❌ Puppeteer failed to launch:", error);
      return false;
    }
  }
  async reloadPage() {
    try {
      await this.page.reload({ waitUntil: "networkidle0" });
      return true;
    } catch (error) {
      return false;
    }
  }

  async goto(urlToVisit) {
    try {
      await this.page.goto(urlToVisit, {
        waitUntil: "load",
      });
      return true;
    } catch (error) {
      fireErrorLog("goto: Error! " + error);
      return false;
    }
  }
  async takePic(filePath) {
    if (!filePath) {
      filePath = path.resolve(__dirname, "../public/images/xBotSnap.jpg");
    }
    try {
      await this.page.screenshot({ path: filePath });
      return true;
    } catch (error) {
      fireErrorLog("takePic() error->", error);
      return false;
    }
  }
  async findAndType(targetElement, text) {
    try {
      let inputElement = await this.page.waitForSelector(targetElement);

      await inputElement.type(text);

      return true;
    } catch (error) {
      fireErrorLog("findAndType: Error! ", error);
      return false;
    }
  }
  async findAndClick(targetElement) {
    try {
      let inputElement = await this.page.waitForSelector(targetElement);
      await inputElement.click();
      return true;
    } catch (error) {
      fireErrorLog("findAndClick: Error! ", error);
      return false;
    }
  }
  async findElement(targetElement, timeoutMs = 30000) {
    try {
      await this.page.waitForSelector(targetElement, { timeout: timeoutMs });

      return true;
    } catch (error) {
      fireErrorLog("findElement: Error! ", error);
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
    } catch (error) {
      fireErrorLog("findAndGetText: Error! ", error);
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
    fireDebugLog("findTextInPage: " + targetText + " was found: " + found);
    return found;
  }
  async findTextInFrame(iFrame, targetText) {
    const found = await iFrame.evaluate(() => {
      return document.body.innerText.includes("your desired text");
    }, targetText);

    fireInfoLog("findTextInFrame: " + targetText + " was found: " + found);
    return found;
  }
  async getLastTweetUrl() {
    let hasVisited = await this.goto(
      process.env.TARGET_WEBSITE + this.botUsername
    );
    if (!hasVisited) return false;

    let foundAndClicked = await this.findAndClick(
      process.env.TWITTER_LAST_POST_IN_PROFILE
    );
    if (!foundAndClicked) return false;

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

    if (!this.isBusy) {
      this.isBusy = true;
      let hasVisited = await this.goto(process.env.TARGET_WEBSITE);
      if (!hasVisited)
        return this.respond(
          false,
          "Could not visit " + process.env.TARGET_WEBSITE
        );
      fireInfoLog("visited " + process.env.TARGET_WEBSITE);
      let foundAndClicked = await this.findAndClick(
        process.env.TWITTER_NEW_TWEET_INPUT
      );
      if (!foundAndClicked) {
        return this.respond(false, "Could not find TWITTER_NEW_TWEET_INPUT");
      }

      fireInfoLog("Found and clicked TWITTER_NEW_TWEET_INPUT");

      let foundAndTyped = await this.findAndType(
        process.env.TWITTER_NEW_TWEET_INPUT,
        text
      );
      if (!foundAndTyped)
        return this.respond(
          false,
          "Could not find and type TWITTER_NEW_TWEET_INPUT"
        );
      fireDebugLog("Found and typed TWITTER_NEW_TWEET_INPUT");

      foundAndClicked = await this.findAndClick(
        process.env.TWITTER_POST_BUTTON
      );
      if (!foundAndClicked)
        return this.respond(
          false,
          "Could not find and click TWITTER_POST_BUTTON"
        );
      fireInfoLog("Found and clicked TWITTER_POST_BUTTON");

      //TODO: scan the page for "Whoops! you posted that already"

      this.isBusy = false;
      this.tweets[userId] = text;
      return this.respond(true, "xBot tweeted!");
    } else {
      fireInfoLog("xBot is busy, queuing task.");
      this.queue.push({ userId, text });
      if (this.queue.length == 1) {
        fireInfoLog("Starting queue monitor.");
        this.startQueueMonitor();
      }
      return this.respond(false, "xBot is busy");
    }
  }
  async twitterSuspects() {
    try {
      const TwitterSuspects = await this.page.waitForSelector(
        `//*[contains(text(), '${process.env.SUSPICION_TEXT}')]`,
        { timeout: 10000 }
      );
      if (TwitterSuspects) {
        fireInfoLog("Found SUSPICION_TEXT!");
        return true;
      } else {
        fireInfoLog("Did NOT find SUSPICION_TEXT!");
        return false;
      }
    } catch (error) {
      fireErrorLog(
        "twitterSuspects() exception! -> Did NOT find SUSPICION_TEXT! : ",
        error
      );
      return false;
    }
  }
  async twitterRequiresCaptcha() {
    try {
      const TwitterSuspects = await this.page.waitForSelector(
        `//*[contains(text(), '${process.env.TWITTER_AUTHENTICATE_TEXT}')]`,
        { timeout: 5000 }
      );

      if (TwitterSuspects) {
        fireInfoLog("Found TWITTER_AUTHENTICATE_TEXT!");
        return true;
      } else {
        fireErrorLog("Did NOT find TWITTER_AUTHENTICATE_TEXT!");
        return false;
      }
    } catch (error) {
      fireErrorLog(
        "twitterRequiresCaptcha() exception! -> Did NOT find TWITTER_AUTHENTICATE_TEXT! ",
        error
      );
      return false;
    }
  }
  async unusualLoginDetected() {
    try {
      return await this.findTextInPage(process.env.TWITTER_UNUSUAL_LOGIN_TEXT);
    } catch (error) {
      fireErrorLog(
        "unusualLoginDetected() exception! -> Did NOT find TWITTER_UNUSUAL_LOGIN_TEXT!",
        error
      );
      return false;
    }
  }
  async arkoseChallengeDetected() {
    const arkoseFrame = await this.page.$("#arkoseFrame");

    if (arkoseFrame) {
      fireInfoLog("arkoseFrame exists! we need you to do stuff");
      return true;
    } else {
      fireInfoLog("Bro the arkoseFrame div DOES NOT exists bro!");
    }
  }
  async twitterWantsVerification() {
    try {
      const TwitterWantsToVerify = await this.page.waitForSelector(
        `//*[contains(text(), '${process.env.VERIFICATION_TEXT}')]`,
        { timeout: 3000 }
      );
      if (TwitterWantsToVerify) {
        fireInfoLog("Alert: found VERIFICATION_TEXT!!");

        const pageContent = await this.page.content();
        let response = {};
        response.success = true;
        response.pageContent = pageContent;
        return response;
      } else {
        fireInfoLog("Did NOT find VERIFICATION_TEXT!");
        let response = {};
        response.success = false;
        return response;
      }
    } catch (error) {
      fireInfoLog(
        "twitterSuspects() exception! -> Did NOT find VERIFICATION_TEXT!",
        error
      );
      return false;
    }
  }
  async closeBrowser() {
    if (this.browser) await this.browser.close();
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
        fireWarnLog("'Error' dialog detected.");
        return true;
      } else {
        fireDebugLog("'Error' dialog did not appear within the timeout.");
        return false;
      }
    } catch (error) {
      fireErrorLog("An error occurred:", error);
      return false;
    }
  }

  async waitForUserConfirmation() {
    return new Promise((resolve) => {
      this.once(XBotEvents.CONTINUE, () => {
        resolve();
      });
    });
  }

  async logOut() {
    await this.goto(process.env.LOGOUT_URL);
    let foundAndClicked = await this.findAndClick(
      process.env.TWITTER_LOGOUT_BUTTON
    );
    if (!foundAndClicked) {
      fireErrorLog("Cant't find TWITTER_LOGOUT_BUTTON");
      return false;
    }
    fireInfoLog("Found TWITTER_LOGOUT_BUTTON");
    this.isLoggedIn = false;
    return true;
  }
  async loginToX(botUsername, botPassword, botEmail) {
    this.isBusy = true;

    if (!this.isLoggedIn) {
      let hasVisited = await this.goto(process.env.LOGIN_URL);
      if (!hasVisited) {
        fireErrorLog("Can't visit " + process.env.LOGIN_URL);
        this.isBusy = false;
        return this.respond(false, "Could not visit " + process.env.LOGIN_URL);
      }
      fireInfoLog("We're at " + process.env.LOGIN_URL);
      let foundAndClicked = await this.findAndClick(
        process.env.TWITTER_USERNAME_INPUT
      );
      if (!foundAndClicked) {
        fireErrorLog("Can't find TWITTER_USERNAME_INPUT");
        this.isBusy = false;
        return this.respond(false, "Can't find TWITTER_USERNAME_INPUT");
      }
      fireInfoLog("Found and clicked TWITTER_USERNAME_INPUT");

      let foundAndTyped = await this.findAndType(
        process.env.TWITTER_USERNAME_INPUT,
        botUsername
      );
      if (!foundAndTyped) {
        fireErrorLog("Can't find and type TWITTER_USERNAME_INPUT");
        this.isBusy = false;
        return this.respond(
          false,
          "Can't find and type TWITTER_USERNAME_INPUT"
        );
      }
      fireInfoLog("Found and typed TWITTER_USERNAME_INPUT");

      foundAndClicked = await this.findAndClick(
        process.env.TWITTER_USERNAME_SUBMIT_BUTTON
      );
      if (!foundAndClicked) {
        fireErrorLog("Can't find and click TWITTER_USERNAME_SUBMIT_BUTTON");
        this.isBusy = false;
        return this.respond(
          false,
          "Can't find and click TWITTER_USERNAME_SUBMIT_BUTTON"
        );
      }
      fireInfoLog("Found and clicked TWITTER_USERNAME_SUBMIT_BUTTON");
      if (
        await this.lookForWrongLoginInfoDialog("we could not find your account")
      ) {
        return this.respond(false, "Bro, your username is fucked up.");
      }

      foundAndClicked = await this.findAndClick(
        process.env.TWITTER_PASSWORD_INPUT
      );

      if (!foundAndClicked) {
        fireErrorLog("Can't find and click TWITTER_PASSWORD_INPUT");

        // let's look for this text We need to make sure that you’re a real person.
        if (await this.twitterRequiresCaptcha()) {
          fireInfoLog("Bro, you need to solve the puzzle!");
          this.emitAWaitForActionEvent("Solve the captcha and press continue");
          await this.waitForUserConfirmation();
        } else {
          fireDebugLog(
            "TWITTER_UNUSUAL_LOGIN_VERIFY_EMAIL_TEXT NOT found!"
          );
        }

        if (await this.unusualLoginDetected()) {
          fireWarnLog(
            "Bro, X detected an unusual login attempt! Will try to calm the bitch down."
          );
          try {
            const findAndTypeResult = await this.findAndType(
              process.env.TWITTER_UNUSUAL_LOGIN_EMAIL_INPUT,
              botEmail
            );
            if (findAndTypeResult)
              fireDebugLog("TWITTER_UNUSUAL_LOGIN_EMAIL_INPUT found!");
            else fireDebugLog("TWITTER_UNUSUAL_LOGIN_EMAIL_INPUT NOT found!");
            //TODO what if findAndTypeResult is false?
            //TODO: this one is not being found
            const findAndClickResult = await this.findAndClick(
              process.env.TWITTER_UNUSUAL_LOGIN_SUBMIT_BUTTON
            );
            if (findAndClickResult)
              fireDebugLog("TWITTER_UNUSUAL_LOGIN_SUBMIT_BUTTON found!");
            else fireDebugLog("TWITTER_UNUSUAL_LOGIN_SUBMIT_BUTTON NOT found!");

            //TODO i think we have to search for this: 'Verify your identity by entering the email address associated with your X account.'
            const unusualLoginEmailText = await this.findTextInPage(
              process.env.TWITTER_UNUSUAL_LOGIN_VERIFY_EMAIL_TEXT
            );
            if (unusualLoginEmailText) {
              fireDebugLog("TWITTER_UNUSUAL_LOGIN_VERIFY_EMAIL_TEXT found!");
              //TODO i should find out the selector for the email input and do it automatically
              this.emitAWaitForActionEvent("Solve the captcha and press continue.")
              await this.waitForUserConfirmation();
            } else {
              fireDebugLog(
                "TWITTER_UNUSUAL_LOGIN_VERIFY_EMAIL_TEXT NOT found!"
              );
            }
            //TODO this is not being found despite apparently having to be the case
            //when my login data is bullshit
            //TODO implement a web server to live debug wtf is going on the
            //remote chrome
            if (await this.lookForWrongLoginInfoDialog("please try again")) {
              return this.respond(false, "Bro, your password is messed up.");
            }
          } catch (error) {
            fireErrorLog("logIntoX() error: ", error);
            this.isBusy = false;
            return this.respond(
              false,
              "Could not go past unusual login attempt!"
            );
          }

          // click TWITTER_UNUSUAL_LOGIN_SUBMIT_BUTTON
        }
        else if (await this.arkoseChallengeDetected()) {
          fireDebugLog("TWITTER_CONFIRMATION_CODE_REQUIRED_TEXT found!");
          this.emitAWaitForActionEvent("Arkose challenge detected!");
          await this.waitForUserConfirmation();
        }
        else {
          fireErrorLog("Bro, we're defeated by Twitter. Dang it.");
          this.isBusy = false;
          return this.respond(
            false,
            "Can't find and click TWITTER_PASSWORD_INPUT"
          );
        }
      } else fireInfoLog("Found and clicked TWITTER_PASSWORD_INPUT");

      foundAndTyped = await this.findAndType(
        process.env.TWITTER_PASSWORD_INPUT,
        botPassword
      );
      if (!foundAndTyped) {
        fireErrorLog("Can't find and type TWITTER_PASSWORD_INPUT");
        this.isBusy = false;
        return this.respond(
          false,
          "Can't find and type TWITTER_PASSWORD_INPUT"
        );
      }
      fireDebugLog("Found and typed TWITTER_PASSWORD_INPUT");
      await this.page.keyboard.press("Enter");
      await this.wait(3000);

      if (await this.lookForWrongLoginInfoDialog("wrong password")) {
        return this.respond(false, "Bro, your password is messed up.");
      }

      const blockedAttempt = await this.findTextInPage(
        "We blocked an attempt to access your account because"
      );
      if (blockedAttempt) {
        return this.respond(
          false,
          "We're temporarily blocked for some reason."
        );
      }

      //TODO gotta check for In order to protect your account from suspicious activity
      //In order to protect your account from suspicious activity, we've sent a confirmation code to ov*******@l*****.***.**. Enter it below to sign in.
      const confirmationCodeRequiredText = await this.findTextInPage(
        process.env.TWITTER_CONFIRMATION_CODE_REQUIRED_TEXT
      );
      if (confirmationCodeRequiredText) {
        fireDebugLog("TWITTER_CONFIRMATION_CODE_REQUIRED_TEXT found!");
        this.emitAWaitForActionEvent("Provide the confirmation code that was sent to your email.");
        await this.waitForUserConfirmation("Provide the confirmation code that was sent to your email.");
      } else {
        fireDebugLog("TWITTER_CONFIRMATION_CODE_REQUIRED_TEXT NOT found!");
      }
      this.isLoggedIn = true;
      this.isBusy = false;
      return this.respond(true, "xBot is logged in!");

      // TODO: i think this is outdated

      //HERE I GOTTA MAKE SURE I PROPERLY LOGGED IN
      // check for Suspicious login prevented
      // const found = await this.findElement(process.env.TWITTER_PASSWORD_INPUT, 5000);
      // if (found) {
      //     this.logger(process.env.DEBUG,"Found TWITTER_PASSWORD_INPUT when i should not, wrong login data assumed.");
      //     this.isBusy = false;
      //     return this.respond(false, "Wrong login information.");
      // }

      //HERE I GOTTA MAKE SURE Twitter is not suspicious and temporarily blocked me

      // this.logger(process.env.DEBUG,"Twitter Bot has logged in, we now will try to detect suspicion.");

      // let confirmedSuspicion = await this.twitterSuspects();

      // if (confirmedSuspicion) {
      //     this.logger(process.env.DEBUG,"Twitter suspects, will try to convince them.");
      //     let emailWasInput = await this.inputEmail();
      //     if (emailWasInput) {
      //         this.logger(process.env.DEBUG,"We succeeded convincing twitter. We're in.");
      //         this.isBusy = false;
      //         return this.respond(true, "xBot is logged in, we convinced Elon!");
      //     }
      //     else {
      //         this.logger(process.env.DEBUG,"We did not convince Elon :(");
      //         this.isBusy = false;
      //         return this.respond(false, "xBot is not logged in :(");
      //     }
      // }
      // else {
      //     this.logger(process.env.DEBUG,"We will now try to see if Twitter wants verification from us.")
      //     let confirmedVerification = await this.twitterWantsVerification();
      //     if (confirmedVerification.success) {
      //         this.logger(process.env.DEBUG,"Twitter wants verification from us!")
      //         // now we must check the code that was sent to us
      //         // (or read the email automatically)
      //         // and send it to the browser.
      //         // The thing is i don't know how to locate that input field yet.
      //         this.isBusy = false;
      //         return this.respond(false, "Bot did NOT log in / Twitter wants verification code.")
      //         // res.download(filePath);
      //     }
      //     else {
      //         this.logger(process.env.DEBUG,"Apparently Twitter does not suspect, so we're logged in!");
      //         this.isLoggedIn = true;
      //         this.isBusy = false;
      //         return this.respond(true, "xBot is logged in!")
      //     }
      // }
    } else {
      fireInfoLog("xBot is already logged in!");
      this.isBusy = false;
      return this.respond(false, "xBot is already logged in!");
    }
  }

  async inputEmail() {
    let foundAndClicked = await this.findAndClick(
      process.env.TWITTER_EMAIL_INPUT
    );
    if (!foundAndClicked) {
      fireErrorLog("Cant't find TWITTER_EMAIL_INPUT");
      return false;
    }
    fireInfoLog("Found TWITTER_EMAIL_INPUT");
    let foundAndTyped = await this.findAndType(
      process.env.TWITTER_EMAIL_INPUT,
      this.botEmail
    );
    if (!foundAndTyped) {
      fireErrorLog("Can't find and type TWITTER_EMAIL_INPUT");
      return false;
    }
    fireInfoLog("Found and typed TWITTER_EMAIL_INPUT");
    await this.page.keyboard.press("Enter");
    return true;
  }
  async inputVerificationCode(code) {
    let foundAndClicked = await this.findAndClick(
      process.env.TWITTER_VERIFICATION_CODE_INPUT
    );
    if (!foundAndClicked) {
      fireErrorLog("Cant't find TWITTER_VERIFICATION_CODE_INPUT");
      return false;
    }
    fireInfoLog("Found TWITTER_VERIFICATION_CODE_INPUT");

    let foundAndTyped = await this.findAndType(
      process.env.TWITTER_VERIFICATION_CODE_INPUT,
      code
    );
    if (!foundAndTyped) {
      fireErrorLog("Can't find and type TWITTER_VERIFICATION_CODE_INPUT");
      return false;
    }
    fireInfoLog("Found and typed TWITTER_VERIFICATION_CODE_INPUT");
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
    this.queueTimer = setInterval(() => this.processQueue(), 5000);
  }
  stopQueueMonitor() {
    clearInterval(this.queueTimer);
  }

  async processQueue() {
    if (!this.isBusy) {
      fireInfoLog(
        "xBot is not busy, so processQueue will start completing pending tasks"
      );

      while (this.queue.length > 0) {
        const nextItem = this.queue.pop();
        await this.tweet(nextItem.userId, nextItem.text);
      }
      this.stopQueueMonitor();
    } else return;
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async takeSnapshotOfTweet(indexId) {
    try {
      // Construct the selector dynamically using the indexId
      const selector = process.env.TWEET_INDEX_SELECTOR.replace(
        "INDEX_ID",
        indexId
      );
      // const selector = `div[data-testid="cellInnerDiv"][style*="transform: translateY(${indexId}px)"]`;

      // Get the element handle of the target div
      const elementHandle = await this.page.$(selector);

      if (elementHandle) {
        const boundingBox = await elementHandle.boundingBox();

        if (boundingBox) {
          const screenshotPath = `${process.env.MEDIA_FOLDER
            }/tweet-screenshot-${Date.now()}.png`;

          await this.page.screenshot({
            path: screenshotPath,
            clip: {
              x: boundingBox.x,
              y: boundingBox.y,
              width: boundingBox.width,
              height: boundingBox.height,
            },
          });
          fireInfoLog(`Screenshot saved at ${screenshotPath}`);
          return { success: true, path: screenshotPath };
        } else {
          fireErrorLog("Bounding box not found for the element.");
          return { success: false, error: "Bounding box not found." };
        }
      } else {
        fireErrorLog("Element not found.");
        return { success: false, error: "Element not found." };
      }
    } catch (error) {
      fireErrorLog(`Error taking snapshot: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async deleteTwitterBookmarks() {
    const timeout = (ms) =>
      new Promise((resolve) =>
        setTimeout(() => resolve(createErrorResponse("Function timed out")), ms)
      );

    return Promise.race([
      this.deleteTwitterBookmarksCore(),
      timeout(5 * 60 * 1000), // 5 minutes
    ]);
  }

  async selectMultipleElements(name, selector, timeout) {
    return await this.withTimeout(
      name,
      this.page.$$(selector),
      timeout // 10 seconds
    );
  }

  async deleteTwitterBookmarksCore() {
    fireInfoLog(`deleteTwitterBookmarksCore() started`);

    // Expose fireDebugLog before evaluating
    if (!(await this.page.evaluate(() => window.fireDebugLog))) {
      await this.page.exposeFunction("fireDebugLog", (message) => {
        fireDebugLog(message);
      });
    }

    try {
      // Usage
      // const handles = await this.withTimeout(
      //   "cellInnerDiv",
      //   this.page.$$(process.env.TWEET_SELECTOR),
      //   10000 // 10 seconds
      // );

      const handles = await this.selectMultipleElements(
        "cellInnerDiv",
        process.env.TWEET_SELECTOR,
        10000
      );

      fireDebugLog("cellInnerDiv handles.length->" + handles.length);
      fireDebugLog("handles->" + handles.length);

      for (const handle of handles) {
        const buttonHandles = await this.withTimeout(
          "bookmarkButton",
          await handle.$$(process.env.BOOKMARK_BUTTON_SELECTOR),
          10000
        );

        if (buttonHandles.length > 0) {
          let matchingParentHandle = null;

          for (const buttonHandle of buttonHandles) {
            const hasMatchingChild = await buttonHandle.evaluate(
              (parent, selector) => {
                // Check if this is the div that holds the 'bookmarked' button
                const path = parent.querySelector(selector);
                return path !== null;
              },
              process.env.TWEET_BOOKMARK_BUTTON_PATH
            );

            if (hasMatchingChild) {
              matchingParentHandle = buttonHandle;
              break;
            }
          }
          if (matchingParentHandle) {
            fireDebugLog("Gonna click the bookmarked button");

            await matchingParentHandle.click();
          } else {
            fireDebugLog("No matching parent handle found.");
          }
        } else {
          fireDebugLog("Less than 1 button found in this cellInnerDiv");
        }
      }
      fireDebugLog("deleteTwitterBookmarksCore() finished");
      return createSuccessResponse();
    } catch (error) {
      fireDebugLog("deleteTwitterBookmarksCore() exception: " + error);
      return createErrorResponse(error);
    }
  }

  storeBookmarks = async (bookmarksToBeReturned) => {
    // const bookmarkDivs = await this.page.$$(process.env.TWEET_SELECTOR);

    const bookmarkDivs = await this.selectMultipleElements(
      "cellInnerDiv",
      process.env.TWEET_SELECTOR,
      10000
    );

    fireDebugLog(`bookmarkDivs.length -> ${bookmarkDivs.length}`);
    fireDebugLog(`bookmarkDivs -> ${JSON.stringify(bookmarkDivs)}`);

    if (bookmarkDivs.length === 0) return -1;

    const htmlContentDivs = await Promise.all(
      bookmarkDivs.map(async (divHandle) => {
        return divHandle.evaluate((div) => div.outerHTML);
      })
    );

    // Process bookmarks
    let processedBookmarks = htmlContentDivs
      .map((div) => {
        const $ = cheerio.load(div);
        const divWithTestId = $(process.env.TWEET_SELECTOR);
        const isLastBookmark =
          divWithTestId.children(process.env.TWEET_SELECTOR_CHILDREN_SELECTOR)
            .length > 0;

        return isLastBookmark
          ? null
          : { htmlContent: div, indexId: this.getTweetId(div) };
      })
      .filter(Boolean); // Remove null values

    for (const newBookmark of processedBookmarks) {
      const $ = cheerio.load(newBookmark.htmlContent);
      const newBookmarkTweetUrl = $(process.env.TWEET_AUTHOR_ANCHOR_SELECTOR)
        .eq(2)
        .attr("href");

      // Check if bookmark already exists
      //TODO: i think this check is failing or better said
      //instead of looking inside this.bookmarks i should do it on the bookmarksToBeReturned
      const idExists = bookmarksToBeReturned.some(
        (bookmark) => bookmark.indexId === newBookmark.indexId
      );

      if (!idExists) {
        fireDebugLog("Storing new bookmark");
        newBookmark.tweetUrlHash = createHash(newBookmarkTweetUrl);
        this.bookmarks.push(newBookmark);

        // Download media if enabled
        if (this.downloadMedia) {
          await this.downloadMediaForBookmark($, newBookmark);
        } else {
          fireDebugLog("Skipping media download");
        }

        fireDebugLog(`Stored bookmark with indexId -> ${newBookmark.indexId}`);
      } else {
        fireDebugLog(
          `Skipping duplicate bookmark with indexId -> ${newBookmark.indexId}`
        );
      }
    }

    fireDebugLog(`this.bookmarks.length -> ${this.bookmarks.length}`);
    fireDebugLog(`this.bookmarks -> ${JSON.stringify(this.bookmarks)}`);
    return this.bookmarks.length;
  };

  downloadMediaForBookmark = async ($, bookmark) => {
    fireDebugLog("Media download initiated");

    const videoPlayerDiv = $(process.env.TWEET_VIDEO_PLAYER_DIV_SELECTOR);
    const imageDiv = $(process.env.TWEET_PHOTO_DIV_SELECTOR);

    // Normalize target website URL
    let targetWebsite = process.env.TARGET_WEBSITE.replace(/\/$/, "");

    if (videoPlayerDiv.length > 0) {
      bookmark.hasLocalMedia = "video";
      const videoPageUrl =
        targetWebsite +
        $(process.env.TWEET_AUTHOR_ANCHOR_SELECTOR).eq(2).attr("href");

      fireDebugLog(`Downloading video: ${videoPageUrl}`);
      const fetchVideoResult = await this.fetchAndSaveVideo(
        videoPageUrl,
        process.env.MEDIA_FOLDER,
        `${bookmark.tweetUrlHash}.mp4`
      );

      if (!fetchVideoResult.success) {
        bookmark.hasLocalMedia = "no";
        fireErrorLog(
          `Error in fetchAndSaveVideo: ${fetchVideoResult.errorMessage}`
        );
        fireNotification(`error--${fetchVideoResult.errorMessage}`);
      }
    } else if (imageDiv.length > 0) {
      bookmark.hasLocalMedia = "image";
      const tweetPhotoUrl = $(process.env.TWEET_PHOTO_IMG_SELECTOR).attr("src");

      fireDebugLog(`Downloading image: ${tweetPhotoUrl}`);
      const fetchImageResult = await this.fetchAndSaveImage(
        tweetPhotoUrl,
        process.env.MEDIA_FOLDER,
        `${bookmark.tweetUrlHash}.jpg`
      );

      if (!fetchImageResult.success) {
        bookmark.hasLocalMedia = "no";
        fireErrorLog(
          `Error in fetchAndSaveImage: ${fetchImageResult.errorMessage}`
        );
        fireNotification(`error--${fetchImageResult.errorMessage}`);
      }
    } else {
      fireDebugLog("No media found for this bookmark");
    }
  };

  scrapeBookmarks = async () => {
    this.keepScraping = true;
    let bookmarksToBeReturned = [];
    let scrollPosition = 0;

    const processBookmarks = async () => {
      let storedCount = await this.storeBookmarks(bookmarksToBeReturned);
      fireDebugLog("Stored bookmarks count -> " + storedCount);
      if (storedCount === -1) return false; // Stop condition

      if (storedCount > 0)
        bookmarksToBeReturned = bookmarksToBeReturned.concat(this.bookmarks);
      this.bookmarks = [];
      return true; // Continue scraping
    };

    while (this.keepScraping) {
      if (!(await processBookmarks())) break;
      if (this.deleteOnlineBookmarks) {
        const deleteTwitterBookmarksResponse =
          await this.deleteTwitterBookmarks();
        fireDebugLog(
          "deleteTwitterBookmarksResponse -> " +
          JSON.stringify(deleteTwitterBookmarksResponse)
        );
      } else {
        fireDebugLog("Gonna scroll...");
        await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await this.wait(3000);

        const newScrollPosition = await this.page.evaluate(
          () => window.scrollY
        );
        if (newScrollPosition <= scrollPosition) {
          fireDebugLog("End of page reached. Stopping.");
          break;
        }
        scrollPosition = newScrollPosition;
      }
    }

    return bookmarksToBeReturned;
  };

  isScrolledToBottom = async () => {
    const result = await this.page.evaluate(() => {
      const scrollTop = document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;
      return Math.ceil(scrollTop + clientHeight) >= scrollHeight;
    });
    return result;
  };
  async withTimeout(id, promise, ms) {
    const errorMessage = id + " operation timed out";
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    );
    return Promise.race([promise, timeout]);
  }

  emitAWaitForActionEvent(message) {
    this.emit(
      XBotEvents.WAIT_FOR_USER_ACTION,
      `X requires user intervention: ${message}`
    );
  }
}
export default XBot;
