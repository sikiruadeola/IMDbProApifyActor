import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from 'playwright';

interface Input {
    discoveryUrl: string;
    authState: string | object;
    maxPages?: number;
    maxProfiles?: number;
}

interface ContactResult {
    imdbId: string;
    profileUrl: string;
    name: string;
    email: string;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalize(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function getImdbId(url: string): string | null {
    const match = url.match(/\/name\/(nm\d+)/i);
    return match ? match[1] : null;
}

function extractEmail(value: string): string | null {
    const match = value.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );

    return match ? match[0].trim() : null;
}

/**
 * Parse authState.
 *
 * We intentionally return `any` here because Playwright's
 * StorageState type changes between Playwright releases.
 *
 * The actual runtime structure is validated before use.
 */
function parseAuthState(value: string | object): any {
    let parsed: unknown;

    try {
        parsed =
            typeof value === 'string'
                ? JSON.parse(value)
                : value;
    } catch (error) {
        throw new Error(
            `Invalid authState JSON: ${errorMessage(error)}`,
        );
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error(
            'authState must be a JSON object.',
        );
    }

    const state = parsed as Record<string, unknown>;

    if (!Array.isArray(state.cookies)) {
        throw new Error(
            'authState.cookies must be an array.',
        );
    }

    if (!Array.isArray(state.origins)) {
        throw new Error(
            'authState.origins must be an array.',
        );
    }

    return state;
}

/**
 * Find the exact visible "Direct Contact" heading.
 */
async function findDirectContactLabel(
    page: Page,
): Promise<Locator | null> {
    const candidates = page.getByText(
        'Direct Contact',
        { exact: true },
    );

    const count = await candidates
        .count()
        .catch(() => 0);

    for (let i = 0; i < count; i++) {
        const candidate = candidates.nth(i);

        if (
            await candidate
                .isVisible()
                .catch(() => false)
        ) {
            return candidate;
        }
    }

    return null;
}

/**
 * Find the DOM container associated with Direct Contact.
 *
 * We walk upward from the exact heading.
 */
async function findDirectContactContainer(
    page: Page,
): Promise<Locator | null> {
    const label =
        await findDirectContactLabel(page);

    if (!label) {
        return null;
    }

    let container = label;

    for (let level = 0; level < 10; level++) {
        const buttons = container.locator(
            'button, [role="button"]',
        );

        const buttonCount = await buttons
            .count()
            .catch(() => 0);

        if (buttonCount > 0) {
            return container;
        }

        container = container.locator(
            'xpath=..',
        );
    }

    return null;
}

/**
 * Find the COPY button ONLY inside Direct Contact.
 *
 * We deliberately do not search the whole page.
 */
async function findDirectContactCopyButton(
    container: Locator,
): Promise<Locator | null> {
    const selectors = [
        'button[aria-label*="copy" i]',
        '[role="button"][aria-label*="copy" i]',
        'button[title*="copy" i]',
        '[role="button"][title*="copy" i]',
        'button:has-text("Copy")',
        '[role="button"]:has-text("Copy")',
        '[data-testid*="copy" i]',
    ];

    for (const selector of selectors) {
        const buttons =
            container.locator(selector);

        const count = await buttons
            .count()
            .catch(() => 0);

        for (let i = 0; i < count; i++) {
            const button = buttons.nth(i);

            if (
                await button
                    .isVisible()
                    .catch(() => false)
            ) {
                return button;
            }
        }
    }

    /*
     * Do not guess when multiple unidentified
     * buttons exist.
     */
    const allButtons = container.locator(
        'button, [role="button"]',
    );

    const count = await allButtons
        .count()
        .catch(() => 0);

    console.log(
        `DIRECT CONTACT: ${count} unidentified buttons found.`,
    );

    /*
     * If exactly one button exists in the
     * Direct Contact container, it is reasonable
     * to treat it as the copy control.
     */
    if (count === 1) {
        const button = allButtons.first();

        if (
            await button
                .isVisible()
                .catch(() => false)
        ) {
            return button;
        }
    }

    return null;
}

/**
 * Read clipboard after the Direct Contact copy
 * button has been clicked.
 */
async function readClipboard(
    page: Page,
): Promise<string> {
    try {
        const text = await page.evaluate(
            async () => {
                try {
                    return await navigator.clipboard.readText();
                } catch {
                    return '';
                }
            },
        );

        return normalize(text);
    } catch {
        return '';
    }
}

/**
 * Find and copy ONLY the Direct Contact email.
 */
async function getDirectContactEmail(
    page: Page,
): Promise<string | null> {
    const label =
        await findDirectContactLabel(page);

    if (!label) {
        console.log(
            'DIRECT CONTACT: NOT FOUND',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: FOUND',
    );

    const container =
        await findDirectContactContainer(page);

    if (!container) {
        console.log(
            'DIRECT CONTACT: container NOT FOUND',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: container found.',
    );

    const copyButton =
        await findDirectContactCopyButton(
            container,
        );

    if (!copyButton) {
        console.log(
            'DIRECT CONTACT: copy button NOT FOUND.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: copy button FOUND.',
    );

    try {
        await copyButton.scrollIntoViewIfNeeded();

        await page.waitForTimeout(300);

        console.log(
            'DIRECT CONTACT: clicking copy button...',
        );

        await copyButton.click({
            timeout: 10_000,
        });
    } catch (error) {
        console.log(
            `DIRECT CONTACT: copy click failed: ${errorMessage(error)}`,
        );

        return null;
    }

    await page.waitForTimeout(700);

    const clipboardText =
        await readClipboard(page);

    if (!clipboardText) {
        console.log(
            'DIRECT CONTACT: clipboard is empty.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: clipboard text received.',
    );

    const email =
        extractEmail(clipboardText);

    if (!email) {
        console.log(
            'DIRECT CONTACT: clipboard contains no email.',
        );

        return null;
    }

    console.log(
        `DIRECT CONTACT EMAIL: ${email}`,
    );

    return email;
}

/**
 * Find IMDbPro profile links on discovery page.
 */
async function findProfileLinks(
    page: Page,
): Promise<string[]> {
    const hrefs = await page
        .locator('a[href*="/name/nm"]')
        .evaluateAll((anchors) =>
            anchors
                .map((anchor) =>
                    (anchor as HTMLAnchorElement).href,
                )
                .filter(Boolean),
        )
        .catch(() => []);

    return [...new Set(hrefs)];
}

/**
 * Process one IMDbPro profile.
 */
async function processProfile(
    context: BrowserContext,
    profileUrl: string,
): Promise<ContactResult | null> {
    const page =
        await context.newPage();

    try {
        const imdbId =
            getImdbId(profileUrl);

        if (!imdbId) {
            console.log(
                `SKIPPED INVALID PROFILE: ${profileUrl}`,
            );

            return null;
        }

        console.log('');
        console.log(
            '========================================',
        );
        console.log(
            `PROCESSING: ${imdbId}`,
        );
        console.log(
            `PROFILE: ${profileUrl}`,
        );
        console.log(
            '========================================',
        );

        try {
            await page.goto(
                profileUrl,
                {
                    waitUntil:
                        'domcontentloaded',
                    timeout: 60_000,
                },
            );
        } catch (error) {
            console.log(
                `PROFILE NAVIGATION FAILED: ${errorMessage(error)}`,
            );

            return null;
        }

        await page.waitForTimeout(2_500);

        console.log(
            `PROFILE URL: ${page.url()}`,
        );

        const name = normalize(
            await page
                .locator('h1')
                .first()
                .textContent()
                .catch(() => ''),
        );

        console.log(
            `PROFILE NAME: ${name || 'Unknown'}`,
        );

        console.log(
            'SEARCHING ONLY FOR DIRECT CONTACT...',
        );

        const email =
            await getDirectContactEmail(
                page,
            );

        /*
         * CRITICAL:
         *
         * No Direct Contact email means
         * absolutely NO dataset record.
         */
        if (!email) {
            console.log(
                'NO DIRECT CONTACT EMAIL.',
            );

            console.log(
                'NOT SAVED TO DATASET.',
            );

            return null;
        }

        console.log(
            `DIRECT CONTACT CONFIRMED: ${email}`,
        );

        return {
            imdbId,
            profileUrl,
            name,
            email,
        };
    } catch (error) {
        console.log(
            `PROFILE ERROR: ${errorMessage(error)}`,
        );

        return null;
    } finally {
        await page
            .close()
            .catch(() => {});
    }
}

async function main(): Promise<void> {
    await Actor.init();

    console.log('');
    console.log(
        '========================================',
    );
    console.log(
        'IMDbPro DIRECT CONTACT SCRAPER',
    );
    console.log(
        '========================================',
    );

    const input =
        (await Actor.getInput()) as Input | null;

    if (!input) {
        throw new Error(
            'No Actor input was provided.',
        );
    }

    if (!input.discoveryUrl) {
        throw new Error(
            'Missing discoveryUrl.',
        );
    }

    if (!input.authState) {
        throw new Error(
            'Missing authState.',
        );
    }

    const maxPages = Math.max(
        1,
        Number(input.maxPages ?? 1),
    );

    const maxProfiles = Math.max(
        1,
        Number(input.maxProfiles ?? 10),
    );

    console.log(
        `DISCOVERY URL: ${input.discoveryUrl}`,
    );

    console.log(
        `MAX PAGES: ${maxPages}`,
    );

    console.log(
        `MAX PROFILES: ${maxProfiles}`,
    );

    const authState =
        parseAuthState(
            input.authState,
        );

    console.log(
        `AUTH COOKIES: ${authState.cookies.length}`,
    );

    console.log(
        `AUTH ORIGINS: ${authState.origins.length}`,
    );

    console.log(
        'Launching Chromium...',
    );

    const browser: Browser =
        await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ],
        });

    /*
     * `as any` here is intentional.
     *
     * Your installed Playwright version has a
     * stricter StorageState definition than our
     * generic authState JSON.
     *
     * Runtime validation happened above.
     */
    const context =
        await browser.newContext({
            storageState: authState as any,

            viewport: {
                width: 1920,
                height: 1080,
            },

            permissions: [
                'clipboard-read',
                'clipboard-write',
            ],
        });

    let totalProcessed = 0;
    let totalSaved = 0;

    try {
        /*
         * ========================================
         * AUTHENTICATION CHECK
         * ========================================
         */

        console.log('');
        console.log(
            '========================================',
        );
        console.log(
            'CHECKING IMDbPro AUTHENTICATION',
        );
        console.log(
            '========================================',
        );

        const authPage =
            await context.newPage();

        try {
            await authPage.goto(
                input.discoveryUrl,
                {
                    waitUntil:
                        'domcontentloaded',
                    timeout: 60_000,
                },
            );

            await authPage.waitForTimeout(
                3_000,
            );

            const authUrl =
                authPage.url();

            const authTitle =
                await authPage.title();

            console.log(
                `AUTH URL: ${authUrl}`,
            );

            console.log(
                `AUTH TITLE: ${authTitle}`,
            );

            /*
             * Correctly escaped slash.
             *
             * This was one of the build errors
             * in the previous version.
             */
            if (
                /signin|login|ap\/signin/i.test(
                    authUrl,
                )
            ) {
                throw new Error(
                    'IMDbPro authentication appears to be invalid or expired.',
                );
            }

            console.log(
                'IMDbPro authentication check passed.',
            );
        } finally {
            await authPage
                .close()
                .catch(() => {});
        }

        /*
         * ========================================
         * DISCOVERY
         * ========================================
         */

        const processedIds =
            new Set<string>();

        for (
            let pageNumber = 1;
            pageNumber <= maxPages;
            pageNumber++
        ) {
            if (
                totalProcessed >=
                maxProfiles
            ) {
                break;
            }

            console.log('');
            console.log(
                '========================================',
            );
            console.log(
                `DISCOVERY PAGE ${pageNumber}`,
            );
            console.log(
                '========================================',
            );

            const discoveryPage =
                await context.newPage();

            try {
                const url =
                    new URL(
                        input.discoveryUrl,
                    );

                url.searchParams.set(
                    'pageNumber',
                    String(pageNumber),
                );

                const discoveryUrl =
                    url.toString();

                console.log(
                    `OPENING: ${discoveryUrl}`,
                );

                try {
                    await discoveryPage.goto(
                        discoveryUrl,
                        {
                            waitUntil:
                                'domcontentloaded',
                            timeout: 60_000,
                        },
                    );
                } catch (error) {
                    console.log(
                        `DISCOVERY NAVIGATION FAILED: ${errorMessage(error)}`,
                    );

                    continue;
                }

                await discoveryPage.waitForTimeout(
                    3_000,
                );

                console.log(
                    `ACTUAL URL: ${discoveryPage.url()}`,
                );

                const profileLinks =
                    await findProfileLinks(
                        discoveryPage,
                    );

                console.log(
                    `PROFILE LINKS FOUND: ${profileLinks.length}`,
                );

                const profiles =
                    profileLinks
                        .map((href) => {
                            const id =
                                getImdbId(href);

                            if (!id) {
                                return null;
                            }

                            return {
                                id,
                                url: `https://pro.imdb.com/name/${id}/`,
                            };
                        })
                        .filter(
                            (
                                profile,
                            ): profile is {
                                id: string;
                                url: string;
                            } =>
                                profile !== null,
                        );

                console.log(
                    `PROFILES FOUND: ${profiles.length}`,
                );

                for (
                    const profile of profiles
                ) {
                    if (
                        totalProcessed >=
                        maxProfiles
                    ) {
                        break;
                    }

                    if (
                        processedIds.has(
                            profile.id,
                        )
                    ) {
                        continue;
                    }

                    processedIds.add(
                        profile.id,
                    );

                    totalProcessed++;

                    const result =
                        await processProfile(
                            context,
                            profile.url,
                        );

                    /*
                     * Null means:
                     *
                     * - no Direct Contact
                     * - no copy button
                     * - copy failed
                     * - no email
                     *
                     * In ALL of these cases,
                     * do not push anything.
                     */
                    if (!result) {
                        continue;
                    }

                    await Actor.pushData(
                        result,
                    );

                    totalSaved++;

                    console.log('');
                    console.log(
                        '*** DIRECT CONTACT SAVED ***',
                    );

                    console.log(
                        `IMDb ID: ${result.imdbId}`,
                    );

                    console.log(
                        `EMAIL: ${result.email}`,
                    );

                    console.log(
                        `PROFILES PROCESSED: ${totalProcessed}`,
                    );

                    console.log(
                        `DIRECT CONTACTS SAVED: ${totalSaved}`,
                    );
                }
            } finally {
                await discoveryPage
                    .close()
                    .catch(() => {});
            }

            console.log('');
            console.log(
                `FINISHED DISCOVERY PAGE ${pageNumber}`,
            );
        }

        console.log('');
        console.log(
            '========================================',
        );
        console.log(
            'SCRAPING FINISHED',
        );
        console.log(
            '========================================',
        );

        console.log(
            `PROFILES PROCESSED: ${totalProcessed}`,
        );

        console.log(
            `DIRECT CONTACTS SAVED: ${totalSaved}`,
        );
    } finally {
        console.log(
            'Closing browser...',
        );

        await context
            .close()
            .catch(() => {});

        await browser
            .close()
            .catch(() => {});
    }

    /*
     * totalSaved is still in scope here.
     *
     * This fixes the previous TS2304 error.
     */
    await Actor.exit(
        `Finished. Saved ${totalSaved} Direct Contact records.`,
    );
}

main().catch(async (error) => {
    console.error('');
    console.error(
        '========================================',
    );
    console.error(
        'ACTOR FAILED',
    );
    console.error(
        '========================================',
    );

    console.error(
        errorMessage(error),
    );

    await Actor.fail(
        errorMessage(error),
    );
});
