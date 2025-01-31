import { XBot } from "../index.js";

test("XBot initializes properly", async () => {
    const bot = new XBot();
    const response = await bot.init();
    expect(response.success).toBe(true);
    await bot.closeBrowser();
});
