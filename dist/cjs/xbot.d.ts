export default XBot;
declare class XBot {
    tweets: {};
    isLoggedIn: boolean;
    isBusy: boolean;
    queue: any[];
    queueTimer: boolean;
    monitorFlag: boolean;
    bookmarks: any[];
    keepScraping: boolean;
    fetchAndSaveImage(imageUrl: any, saveDir: any, saveFileName: any): Promise<any>;
    fetchAndSaveVideo(videoPageurl: any, saveDir: any, saveFileName: any): Promise<any>;
    getId(divHtmlContent: any): string;
    setBusy(state: any): boolean;
    getTweet(userId: any): any;
    init(showProgressFunction: any, sendMessageToMainWindow: any, waitForNewReport: any): Promise<{}>;
    showProgressFunction: any;
    sendMessageToMainWindow: any;
    waitForNewReport: any;
    browser: import("puppeteer").Browser | undefined;
    page: import("puppeteer").Page | undefined;
    goto(urlToVisit: any): Promise<boolean>;
    takePic(filePath: any): Promise<boolean>;
    findAndType(targetElement: any, text: any): Promise<boolean>;
    findAndClick(targetElement: any): Promise<boolean>;
    findElement(targetElement: any, timeoutMs?: number): Promise<boolean>;
    findAndGetText(targetElement: any): Promise<false | {
        success: boolean;
        text: any;
    }>;
    getCurrentBotUrl(): string;
    findTextInPage(targetText: any): Promise<boolean>;
    findTextInFrame(iFrame: any, targetText: any): Promise<any>;
    getLastTweetUrl(): Promise<string | false>;
    tweet(userId: any, text: any): Promise<{
        success: any;
        message: any;
        data: any;
    }>;
    twitterSuspects(): Promise<boolean>;
    twitterRequiresCaptcha(): Promise<boolean>;
    unusualLoginDetected(): Promise<boolean>;
    arkoseChallengeDetected(): Promise<true | undefined>;
    twitterWantsVerification(): Promise<false | {
        success: boolean;
    }>;
    closeBrowser(): Promise<void>;
    lookForWrongLoginInfoDialog(textToLookFor: any): Promise<boolean>;
    logOut(): Promise<boolean>;
    loginToX(botUsername: any, botPassword: any, botEmail: any): Promise<{
        success: any;
        message: any;
        data: any;
    }>;
    inputEmail(): Promise<boolean>;
    inputVerificationCode(code: any): Promise<boolean>;
    respond(success: any, message: any, data: any): {
        success: any;
        message: any;
        data: any;
    };
    startQueueMonitor(): void;
    stopQueueMonitor(): void;
    processQueue(xBotClassContext: any): Promise<void>;
    wait(ms: any): Promise<any>;
    takeSnapshotOfBookmark(indexId: any): Promise<{
        success: boolean;
        path: string;
        error?: undefined;
    } | {
        success: boolean;
        error: any;
        path?: undefined;
    }>;
    deleteTwitterBookmarks2(): Promise<any>;
    deleteTwitterBookmarks2Core(): Promise<{
        success: boolean;
        errorMessage: any;
    } | {
        success: boolean;
        data: any;
    }>;
    deleteTwitterBookmarks(): Promise<void>;
    storeBookmarks: () => Promise<number>;
    scrapeBookmarks: () => Promise<any[]>;
    isScrolledToBottom: () => Promise<boolean>;
    withTimeout(id: any, promise: any, ms: any): Promise<any>;
}
