import { launch, shot, makeSmallRepo } from './helpers.ts'
const { app, page } = await launch({ workspace: makeSmallRepo() })
await page.waitForTimeout(1500)
console.log('title', await page.title(), await shot(page, 'smoke'))
console.log(JSON.stringify(await page.evaluate(() => (window as any).api.listEditors())))
await app.close()
