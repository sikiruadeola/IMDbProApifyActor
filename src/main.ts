import { Actor } from 'apify';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';

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

interface AuthState {
    cookies: unknown[];
    origins: unknown[];
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
 * Find the exact "Direct Contact" text.
 *
 * IMPORTANT:
 * We do not search the page for emails.
 * We first identify Direct Contact and then work only
 * inside its local DOM container.
 */
async function findDirectContactLabel(
    page: Page,
): Promise<Locator | null> {
    const candidates = page.getByText('Direct Contact', {
        exact: true,
    });

    const count = await candidates.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
        const candidate = candidates.nth(i);

        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    return null;
}

/**
 * Find a container belonging to Direct Contact.
 *
 * We walk upward from the exact Direct Contact label.
 * The first useful ancestor containing buttons is preferred.
 */
async function findDirectContactContainer(
    page: Page,
): Promise<Locator | null> {
    const label = await findDirectContactLabel(page);

    if (!label) {
        return null;
    }

    let container = label;

    for (let level = 0; level < 10; level++) {
        const buttons = container.locator('button, [role="button"]');

        const count = await buttons.count().catch(() => 0);

        if (count > 0) {
            return container;
        }

        container = container.locator('xpath=..');
    }

    return null;
}

/**
 * Look for a COPY control ONLY inside the Direct Contact container.
 *
 * We never search the entire page.
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
        const buttons = container.locator(selector);
        const count = await buttons.count().catch(() => 0);

        for (let i = 0; i < count; i++) {
            const button = buttons.nth(i);

            if (await button.isVisible().catch(() => false)) {
                return button;
            }
        }
    }

    /*
     * IMDbPro may render the copy icon without accessible
     * "Copy" text. In that situation we inspect buttons inside
     * the Direct Contact container.
     */
    const buttons = container.locator('button, [role="button"]');
    const count = await buttons.count().catch(() => 0);

    if (count === 1) {
        const onlyButton = buttons.first();

        if (await onlyButton.isVisible().catch(() => false)) {
            return onlyButton;
        }
    }

    /*
     * If there are multiple buttons, do NOT guess.
     *
     * Guessing here could copy an agent, manager or representative.
     */
    console.log(
        `DIRECT CONTACT: ${count} buttons found but no identifiable copy button.`,
    );

    return null;
}

/**
 * Install a clipboard capture hook.
 *
 * IMDbPro's copy icon normally writes to navigator.clipboard.
 * Capturing writeText gives us the exact value copied by the
 * button, without scanning unrelated page text.
 */
async function installClipboardCapture(
    page: Page,
): Promise<void> {
    await page.addInitScript(() => {
        const clipboard = navigator.clipboard;

        if (!clipboard) {
            return;
        }

        const originalWriteText = clipboard.writeText.bind(clipboard);

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                ...clipboard,

                writeText: async (text: string) => {
                    (
                        window as Window & {
                            __imdbCopiedText?: string;
                        }
                    ).__imdbCopiedText = text;

                    return originalWriteText(text).catch(() => undefined);
                },

                readText: async () => {
                    const captured = (
                        window as Window & {
                            __imdbCopiedText?: string;
                        }
                    ).__imdbCopiedText;

                    if (captured) {
                        return captured;
                    }

                    try {
                        return await clipboard.readText();
                    } catch {
                        return '';
                    }
                },
            },
        });
    });
}

/**
 * Read the value captured by the clipboard hook.
 */
async function getCapturedClipboard(
    page: Page,
): Promise<string> {
    return page.evaluate(() => {
        return (
            window as Window & {
                __imdbCopiedText?: string;
            }
        ).__imdbCopiedText ?? '';
    }).catch(() => '');
}

/**
 * Extract ONLY Direct Contact.
 */
async function getDirectContactEmail(
    page: Page,
): Promise<string | null> {
    const label = await findDirectContactLabel(page);

    if (!label) {
        console.log('DIRECT CONTACT: NOT FOUND');
        return null;
    }

    console.log('DIRECT CONTACT: FOUND');

    const container = await findDirectContactContainer(page);

    if (!container) {
        console.log(
            'DIRECT CONTACT: container could not be identified.',
        );
        return null;
    }

    console.log('DIRECT CONTACT: container identified.');

    const copyButton = await findDirectContactCopyButton(
        container,
    );

    if (!copyButton) {
        console.log(
            'DIRECT CONTACT: copy button NOT found.',
        );
        return null;
    }

    console.log(
        'DIRECT CONTACT: copy button found.',
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

    /*
     * Give the UI time to perform the clipboard operation.
     */
    await page.waitForTimeout(700);

    let copiedText = await getCapturedClipboard(page);

    if (!copiedText) {
        copiedText = await page.evaluate(async () => {
            try {
                return await navigator.clipboard.readText();
            } catch {
                return '';
            }
        }).catch(() => '');
    }

    copiedText = normalize(copiedText);

    if (!copiedText) {
        console.log(
            'DIRECT CONTACT: copy succeeded visually, but clipboard was empty.',
        );

        return null;
    }

    console.log(
        `DIRECT CONTACT: clipboard value received.`,
    );

    const email = extractEmail(copiedText);

    if (!email) {
        console.log(
            'DIRECT CONTACT: clipboard did not contain an email.',
        );

        return null;
    }

    console.log(
        `DIRECT CONTACT EMAIL: ${email}`,
    );

    return email;
}

/**
 * Find profile links on the discovery page.
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
    const page = await context.newPage();

    try {
        await installClipboardCapture(page);

        const imdbId = getImdbId(profileUrl);

        if (!imdbId) {
            console.log(
                `SKIPPED: Invalid IMDb profile URL: ${profileUrl}`,
            );

            return null;
        }

        console.log('');
        console.log('========================================');
        console.log(`PROCESSING: ${imdbId}`);
        console.log(`PROFILE: ${profileUrl}`);
        console.log('========================================');

        try {
            await page.goto(profileUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 60_000,
            });
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

        const title = await page.title().catch(() => '');

        console.log(
            `PROFILE TITLE: ${title}`,
        );

        /*
         * Get name only for successful records.
         */
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

        /*
         * THE IMPORTANT PART:
         *
         * We only look for Direct Contact.
         */
        console.log(
            'SEARCHING ONLY FOR DIRECT CONTACT...',
        );

        const email = await getDirectContactEmail(page);

        /*
         * ABSOLUTE RULE:
         *
         * No Direct Contact email = no dataset record.
         */
        if (!email) {
            console.log(
                'RESULT: NO DIRECT CONTACT EMAIL',
            );

            console.log(
                'NOT SAVED TO DATASET.',
            );

            return null;
        }

        console.log(
            `RESULT: DIRECT CONTACT EMAIL FOUND`,
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
        await page.close().catch(() => {});
    }
}

/**
 * Parse and validate Actor input.
 */
function parseAuthState(
    value: string | object,
): AuthState {
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

    if (
        !parsed ||
        typeof parsed !== 'object'
    ) {
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

    return {
        cookies: state.cookies,
        origins: state.origins,
    };
}

async function main(): Promise<void> {
    await Actor.init();

    console.log('');
    console.log('========================================');
    console.log('IMDbPro DIRECT CONTACT SCRAPER');
    console.log('========================================');

    const input = (await Actor.getInput()) as Input | null;

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

    const authState = parseAuthState(
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

    const context =
        await browser.newContext({
            storageState: authState,
            viewport: {
                width: 1920,
                height: 1080,
            },
            permissions: [
                'clipboard-read',
                'clipboard-write',
            ],
        });

    try {
        /*
         * Authentication check.
         */
        console.log('');
        console.log('========================================');
        console.log('CHECKING IMDbPro AUTHENTICATION');
        console.log('========================================');

        const authPage =
            await context.newPage();

        try {
            await authPage.goto(
                input.discoveryUrl,
                {
                    waitUntil: 'domcontentloaded',
                    timeout: 60_000,
                },
            );

            await authPage.waitForTimeout(3_000);

            console.log(
                `AUTH URL: ${authPage.url()}`,
            );

            console.log(
                `AUTH TITLE: ${await authPage.title()}`,
            );

            const currentUrl =
                authPage.url();

            if (
                /signin|login|ap/signin/i.test(
                    currentUrl,
                )
            ) {
                throw new Error(
                    'IMDbPro authentication appears to be invalid or expired.',
                );
            }
        } finally {
            await authPage.close().catch(() => {});
        }

        let totalProcessed = 0;
        let totalSaved = 0;

        /*
         * Prevent duplicates across pages.
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
            console.log('========================================');
            console.log(
                `DISCOVERY PAGE ${pageNumber}`,
            );
            console.log('========================================');

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
                        `DISCOVERY PAGE FAILED: ${errorMessage(error)}`,
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

                const uniqueProfiles =
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
                                value,
                            ): value is {
                                id: string;
                                url: string;
                            } => value !== null,
                        );

                console.log(
                    `UNIQUE PROFILES FOUND: ${uniqueProfiles.length}`,
                );

                for (
                    const profile of uniqueProfiles
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
                     * IMPORTANT:
                     *
                     * processProfile returns null
                     * when there is no Direct Contact.
                     *
                     * Therefore pushData is NEVER
                     * called for those profiles.
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
        console.log('========================================');
        console.log('SCRAPING FINISHED');
        console.log('========================================');

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

    await Actor.exit(
        `Finished. Saved ${totalSaved} Direct Contact records.`,
    );
}

main().catch(async (error) => {
    console.error('');
    console.error('========================================');
    console.error('ACTOR FAILED');
    console.error('========================================');
    console.error(
        errorMessage(error),
    );

    await Actor.fail(
        errorMessage(error),
    );
});
