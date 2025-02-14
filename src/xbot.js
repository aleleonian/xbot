import { createErrorResponse, createHash, createSuccessResponse } from "./util/common.js";
import { setEmitter, fireDebugLog, fireErrorLog, fireWarnLog, fireInfoLog } from './util/events.js'
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
    }).catch(error => {
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
      : createHash(divHtmlContent);
  }

  setBusy(state) {
    this.isBusy = state;
    return true;
  }
  getTweet(userId) {
    return this.tweets[userId];
  }
  async init() {

    setEmitter(this);

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
        this.page.setDefaultTimeout(10000);
        return responseObject;
      }
    }
    catch (error) {
      if (this.browser) await this.browser.close();
      fireErrorLog("❌ Puppeteer failed to launch:", error);
    }
  }
  async goto(urlToVisit) {
    try {
      await this.page.goto(urlToVisit, {
        waitUntil: "load",
      });
      return true;
    } catch (error) {
      fireErrorLog("goto: Error! ", error);
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
      "https://www.x.com" + "/" + this.botUsername
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
      let hasVisited = await this.goto("https://www.x.com");
      if (!hasVisited) return this.respond(false, "Could not visit x.com");
      fireInfoLog("visited x.com");
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
      fireErrorLog("twitterSuspects() exception! -> Did NOT find SUSPICION_TEXT! : ", error);
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
      fireErrorLog("twitterRequiresCaptcha() exception! -> Did NOT find TWITTER_AUTHENTICATE_TEXT! ",
        error);
      return false;
    }
  }
  async unusualLoginDetected() {
    try {
      return await this.findTextInPage(process.env.TWITTER_UNUSUAL_LOGIN_TEXT);
    } catch (error) {

      fireErrorLog("unusualLoginDetected() exception! -> Did NOT find TWITTER_UNUSUAL_LOGIN_TEXT!", error);
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
      fireInfoLog("twitterSuspects() exception! -> Did NOT find VERIFICATION_TEXT!",
        error);
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
  async logOut() {
    await this.goto("https://x.com/logout");
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
      let hasVisited = await this.goto("https://www.x.com/login");
      if (!hasVisited) {
        fireErrorLog("Can't visit https://www.x.com");
        this.isBusy = false;
        return this.respond(false, "Could not visit x.com");
      }
      fireInfoLog("We're at https://www.x.com");
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
        } else if (await this.unusualLoginDetected()) {
          fireWarnLog("Bro, X detected an unusual login attempt! Will try to calm the bitch down.");
          try {
            await this.findAndType(
              process.env.TWITTER_UNUSUAL_LOGIN_EMAIL_INPUT,
              botEmail
            );
            //TODO what if findAndTypeResult is false?
            await this.findAndClick(
              process.env.TWITTER_UNUSUAL_LOGIN_SUBMIT_BUTTON
            );
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
        } else if (await this.arkoseChallengeDetected()) {
          //TODO: instead of waiting 20 seconds, i should make a button appear on the main
          //screen that reads 'continue' and you solve the captcha and then click it and then
          //scraping resumes.

          // a button should show up in the main screen

          // this function should enter an indefinite loop that only breaks
          // when some external condition changes
          // that external condition would be changed by the clicking of that button
          fireWarnLog("Bro we need you to do something about this situation, will give you 20 seconds.");
          await this.wait(20000);
        } else {
          fireErrorLog("Bro, we're defeated by Twitter. Dang it.");
          this.isBusy = false;
          return this.respond(
            false,
            "Can't find and click TWITTER_PASSWORD_INPUT"
          );
        }
      } else
        fireInfoLog("Found and clicked TWITTER_PASSWORD_INPUT");

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

  // async processQueue() {
  //   if (!this.isBusy) {
  //     this.logger("xBot is not busy, processing queue...");
  //     while (this.queue.length > 0) {
  //       const nextItem = this.queue.pop();
  //       this.logger(`Processing: ${JSON.stringify(nextItem)}`);
  //       await this.tweet(nextItem.userId, nextItem.text);
  //     }
  //     this.stopQueueMonitor();
  //   }
  // }

  async processQueue() {
    if (!this.isBusy) {
      fireInfoLog("xBot is not busy, so processQueue will start completing pending tasks");

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

  async deleteTwitterBookmarks2() {
    const timeout = (ms) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve(createErrorResponse("Function timed out")),
          ms
        )
      );

    return Promise.race([
      this.deleteTwitterBookmarks2Core(),
      timeout(5 * 60 * 1000), // 5 minutes
    ]);
  }

  async deleteTwitterBookmarks2Core() {
    fireInfoLog(`deleteTwitterBookmarks2() started`);

    try {
      // Usage
      const handles = await this.withTimeout(
        "cellInnerDiv",
        this.page.$$('[data-testid="cellInnerDiv"]'),
        10000 // 10 seconds
      );

      fireInfoLog("cellInnerDiv handles.length->", handles.length);

      for (const handle of handles) {
        const buttonHandles = await this.withTimeout(
          "bookmarkButton",
          await handle.$$(
            '[role="button"][aria-label][class="css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l"]'
          ),
          10000
        );

        if (buttonHandles.length > 0) {
          let matchingParentHandle = null;
          let savedTweetHtml = "";

          for (const buttonHandle of buttonHandles) {
            const hasMatchingChild = await buttonHandle.evaluate((parent) => {
              // Check if this is the div that holds the 'bookmarked' button
              const path = parent.querySelector(
                'path[d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"]'
              );
              return path !== null;
            });
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
      fireDebugLog("deleteTwitterBookmarks2() finished");
      return createSuccessResponse();
    } catch (error) {
      return createErrorResponse(error);
    }
  }

  async deleteTwitterBookmarks() {
    await this.page.waitForSelector('[aria-label="Bookmarked"]');

    //TODO: Bookmarked is in english, but it could be another language
    // Get all buttons with the `aria-label="Bookmarked"`
    let bookmarkButtons = await this.page.$$('[aria-label="Bookmarked"]');

    // while (bookmarkButtons.length > 0) {
    fireDebugLog(`Found ${bookmarkButtons.length} bookmark buttons.`);

    // Function to delay execution for a specified time

    // Loop through the buttons and click them with a 2-second delay
    for (let i = 0; i < bookmarkButtons.length; i++) {
      try {
        await bookmarkButtons[i].click();
        fireDebugLog(`Clicked button ${i + 1}`);
      } catch (error) {
        fireErrorLog(`Error clicking button ${i + 1}:`, error);
      }

      // Delay for 2 seconds
      await this.wait(1000);
    }
    fireDebugLog("Finished clicking all bookmark buttons.");
  }

  storeBookmarks = async () => {
    const bookmarkDivs = await this.page.$$('[data-testid="cellInnerDiv"]');
    fireDebugLog("bookmarkDivs.length->", bookmarkDivs.length);

    if (bookmarkDivs.length == 0) return -1;

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
        const isLastBookmark =
          divWithTestId.children(".css-175oi2r.r-4d76ec").length > 0;
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

      // this.emit(XBotEvents.CHECK_SAVED_TWEET_EXISTS, newBookmarkTweetUrl);

      // this.logger("gonna wait for waitForNewReport()");

      // const waitForNewReportResponse = await this.waitForNewReport();

      // this.logger(
      //   process.env.DEBUG,
      //   "waitForNewReportResponse->",
      //   JSON.stringify(waitForNewReportResponse)
      // );

      // if (waitForNewReportResponse.success) {
      //   this.logger(
      //     process.env.DEBUG,
      //     waitForNewReportResponse.tweetUrl + " already exists, skipping!"
      //   );
      //   continue;
      // }

      // have we processed this bookmark already?
      const idExists = this.bookmarks.some(
        (bookmark) => bookmark.indexId === newBookmark.indexId
      );
      if (!idExists) {
        fireDebugLog("We do have to store this bookmark");
        newBookmark.tweetUrlHash = createHash(newBookmarkTweetUrl);
        this.bookmarks.push(newBookmark);
        if (this.downloadMedia) {
          fireDebugLog("We do have to download images!");
          const videoPlayerDiv = $('div[data-testid="videoPlayer"]');
          const imageDiv = $('div[data-testid="tweetPhoto"]');
          if (videoPlayerDiv.length > 0) {
            newBookmark.hasLocalMedia = "video";
            const videoPageUrl =
              "https://x.com" +
              $('[data-testid="User-Name"] a').eq(2).attr("href");
            fireDebugLog("Gotta download the video at: ",
              videoPageUrl);
            const fetchVideoResult = await this.fetchAndSaveVideo(
              videoPageUrl,
              process.env.MEDIA_FOLDER,
              newBookmark.tweetUrlHash + ".mp4"
            );

            if (!fetchVideoResult.success) {
              newBookmark.hasLocalMedia = "no";
              fireNotification(`error--Trouble with fetchAndSaveVideo(): ${fetchVideoResult.errorMessage}`);
            }
          } else if (imageDiv.length > 0) {
            newBookmark.hasLocalMedia = "image";
            const tweetPhothUrl = $('[data-testid="tweetPhoto"] img').attr(
              "src"
            );
            fireDebugLog("Gotta download this pic: ",
              tweetPhothUrl);
            const fecthImageResult = await this.fetchAndSaveImage(
              tweetPhothUrl,
              process.env.MEDIA_FOLDER,
              newBookmark.tweetUrlHash + ".jpg"
            );
            if (!fecthImageResult.success) {
              fireNotification(`error--Trouble with fetchAndSaveImage(): ${fecthImageResult.errorMessage}`);
              newBookmark.hasLocalMedia = "no";
            }
          }
        } else {
          fireDebugLog("We do NOT have to download images!");
        }
        // TODO: on HOLD
        // const takeSnapshotOfBookmarkResponse =
        //   await this.takeSnapshotOfBookmark(newBookmark.indexId);
        // this.logger(
        //   "takeSnapshotOfBookmarkResponse->",
        //   JSON.stringify(takeSnapshotOfBookmarkResponse)
        // );
        // not sure about this
        // if (takeSnapshotOfBookmarkResponse.success) {
        //   sendMessageToMainWindow("SNAPSHOT_TAKEN");
        // }
        fireDebugLog("newBookmark.indexId->",
          newBookmark.indexId);
      } else
        fireDebugLog("we do not need to store bookmark with id:",
          newBookmark.indexId);
    }
    return this.bookmarks.length;
  };
  scrapeBookmarks = async () => {
    this.keepScraping = true;
    let bookmarksCopy = [];
    let scrollPosition = 0;

    while (this.keepScraping) {
      let howManyStoredBookmarks = await this.storeBookmarks();
      fireDebugLog("howManyStoredBookmarks->", howManyStoredBookmarks);
      if (howManyStoredBookmarks == -1) break;
      if (howManyStoredBookmarks > 0)
        bookmarksCopy = bookmarksCopy.concat(this.bookmarks);
      this.bookmarks = [];
      if (this.deleteOnlineBookmarks) {
        const deleteTwitterBookmarks2Response =
          await this.deleteTwitterBookmarks2();
        fireDebugLog("deleteTwitterBookmarks2Response->",
          JSON.stringify(deleteTwitterBookmarks2Response));
      } else {
        fireDebugLog("Gonna scroll...");
        await this.page.evaluate(() => {
          window.scrollBy(0, window.innerHeight);
        });
        // Wait for a while after each scroll to give time for content loading
        await this.wait(3000);

        howManyStoredBookmarks = await this.storeBookmarks();
        // if (howManyStoredBookmarks < 1) break;
        if (howManyStoredBookmarks == -1) break;
        if (howManyStoredBookmarks > 0)
          bookmarksCopy = bookmarksCopy.concat(this.bookmarks);
        this.bookmarks = [];
        fireDebugLog("Bookmarks stored.");

        // Get the scroll position
        const newScrollPosition = await this.page.evaluate(() => {
          return window.scrollY;
        });

        if (newScrollPosition > scrollPosition) {
          fireDebugLog("Looping again.");
          scrollPosition = newScrollPosition;
        } else if (newScrollPosition <= scrollPosition) {
          fireDebugLog("End of page reached. Stopping.");
          break;
        }
      }
    }

    return bookmarksCopy;
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
}
export default XBot;
