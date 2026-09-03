```ts
import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from 'playwright';

// ============================================================================
// TYPES
// ============================================================================

interface Input {
    startUrl: string;
    authState: unknown;
    maxPages?: number;
    maxProfiles?: number;
}

interface Person {
    imdbId: string;
    name: string;
    profileUrl: string;
}

interface DirectContactResult {
    imdbId: string;
    profileUrl: string;
    name: string;
    email: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PROFILE_WAIT_MS = 3000;
const DISCOVERY_WAIT_MS = 5000;
const DIRECT_CONTACT_WAIT_MS = 2500;

// ============================================================================
// GENERAL HELPERS
// ============================================================================

function errorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : String(error);
}

function normalizeText(
    value: string | null | undefined,
): string {
    return (value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractImdbId(
    url: string,
): string | null {
    const match = url.match(
        /\/name\/(nm\d+)/i,
    );

    return match ? match[1] : null;
}

function extractEmail(
    value: string,
): string | null {
    const match = value.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );

    return match
        ? match[0].trim()
        : null;
}

// ============================================================================
// AUTH STATE
// ============================================================================

function parseAuthState(
    value: unknown,
): any {
    if (
        value === null ||
        value === undefined
    ) {
        throw new Error(
            'authState is required.',
        );
    }

    let parsed: unknown = value;

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (!trimmed) {
            throw new Error(
                'authState is empty.',
            );
        }

        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(
                `Could not parse authState JSON: ${errorMessage(error)}`,
            );
        }
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error(
            'authState must be a Playwright storage-state JSON object.',
        );
    }

    const state =
        parsed as Record<string, unknown>;

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

// ============================================================================
// LOCATOR HELPERS
// ============================================================================

async function isVisible(
    locator: Locator,
): Promise<boolean> {
    try {
        return await locator.isVisible();
    } catch {
        return false;
    }
}

async function getVisibleLocators(
    root: Locator,
    selector: string,
): Promise<Locator[]> {
    const locator = root.locator(selector);

    const count = await locator
        .count()
        .catch(() => 0);

    const results: Locator[] = [];

    for (
        let i = 0;
        i < count;
        i++
    ) {
        const candidate =
            locator.nth(i);

        if (
            await isVisible(candidate)
        ) {
            results.push(candidate);
        }
    }

    return results;
}

async function safeClick(
    locator: Locator,
): Promise<boolean> {
    try {
        await locator
            .scrollIntoViewIfNeeded()
            .catch(() => {});

        await locator.click({
            timeout: 10000,
        });

        return true;
    } catch {
        try {
            await locator.click({
                timeout: 10000,
                force: true,
            });

            return true;
        } catch {
            return false;
        }
    }
}

// ============================================================================
// PROFILE NAME
// ============================================================================

async function getProfileName(
    page: Page,
): Promise<string> {
    const selectors = [
        'h1',
        '[data-testid*="name-header" i] h1',
        '[data-testid*="name" i] h1',
    ];

    for (
        const selector of selectors
    ) {
        const locator =
            page.locator(selector);

        const count = await locator
            .count()
            .catch(() => 0);

        for (
            let i = 0;
            i < count;
            i++
        ) {
            const text =
                normalizeText(
                    await locator
                        .nth(i)
                        .innerText()
                        .catch(() => ''),
                );

            if (
                text.length > 0 &&
                text.length < 200
            ) {
                return text;
            }
        }
    }

    return '';
}

// ============================================================================
// CONTACT CONTROL
// ============================================================================

/**
 * Find the control that opens the contact information.
 *
 * This is ONLY the control used to reveal contact information.
 * We do not extract any email from this control.
 */
async function findContactControl(
    page: Page,
): Promise<Locator | null> {
    const selectors = [
        'button:has-text("Contact")',
        '[role="button"]:has-text("Contact")',
        'a:has-text("Contact")',
        '[aria-label*="Contact" i]',
        '[title*="Contact" i]',
    ];

    for (
        const selector of selectors
    ) {
        const candidates =
            await getVisibleLocators(
                page.locator('body'),
                selector,
            );

        for (
            const candidate of candidates
        ) {
            const text =
                normalizeText(
                    await candidate
                        .innerText()
                        .catch(() => ''),
                );

            const aria =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'aria-label',
                        )
                        .catch(() => null),
                );

            const title =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'title',
                        )
                        .catch(() => null),
                );

            const combined =
                `${text} ${aria} ${title}`;

            if (
                /contact/i.test(
                    combined,
                )
            ) {
                return candidate;
            }
        }
    }

    return null;
}

// ============================================================================
// DIRECT CONTACT SECTION
// ============================================================================

/**
 * Find the exact "Direct Contact" heading.
 *
 * We intentionally require the exact visible text.
 */
async function findDirectContactHeading(
    page: Page,
): Promise<Locator | null> {
    const candidates =
        page.getByText(
            'Direct Contact',
            {
                exact: true,
            },
        );

    const count = await candidates
        .count()
        .catch(() => 0);

    for (
        let i = 0;
        i < count;
        i++
    ) {
        const candidate =
            candidates.nth(i);

        if (
            await isVisible(candidate)
        ) {
            return candidate;
        }
    }

    return null;
}

/**
 * Find the smallest useful DOM container around
 * the Direct Contact heading.
 *
 * We do NOT search the entire page for a copy button.
 */
async function findDirectContactContainer(
    page: Page,
    heading: Locator,
): Promise<Locator | null> {
    let current = heading;

    for (
        let level = 0;
        level < 10;
        level++
    ) {
        const text =
            normalizeText(
                await current
                    .innerText()
                    .catch(() => ''),
            );

        const buttons =
            current.locator(
                'button, [role="button"]',
            );

        const buttonCount =
            await buttons
                .count()
                .catch(() => 0);

        /*
         * A useful Direct Contact container normally
         * contains the heading plus its action control.
         */
        if (
            buttonCount > 0 &&
            /Direct Contact/i.test(text)
        ) {
            return current;
        }

        const parent =
            current.locator(
                'xpath=..',
            );

        if (
            await parent
                .count()
                .catch(() => 0) === 0
        ) {
            break;
        }

        current = parent;
    }

    return null;
}

// ============================================================================
// COPY BUTTON
// ============================================================================

/**
 * Find ONLY the copy control associated with Direct Contact.
 *
 * We support the common accessible implementations:
 *
 * - aria-label="Copy"
 * - title="Copy"
 * - data-testid containing "copy"
 * - button containing "Copy"
 *
 * We intentionally DO NOT select an arbitrary button if
 * multiple buttons are present. That prevents us from
 * accidentally clicking an agent/manager/representative
 * control.
 */
async function findDirectContactCopyButton(
    container: Locator,
): Promise<Locator | null> {
    const selectors = [
        'button[aria-label*="copy" i]',
        '[role="button"][aria-label*="copy" i]',
        'button[title*="copy" i]',
        '[role="button"][title*="copy" i]',
        'button[data-testid*="copy" i]',
        '[role="button"][data-testid*="copy" i]',
        'button:has-text("Copy")',
        '[role="button"]:has-text("Copy")',
    ];

    for (
        const selector of selectors
    ) {
        const candidates =
            await getVisibleLocators(
                container,
                selector,
            );

        if (
            candidates.length > 0
        ) {
            return candidates[0];
        }
    }

    /*
     * IMDbPro's UI may render the copy control
     * as an icon-only button without an accessible
     * "copy" label.
     *
     * Inspect buttons in the Direct Contact
     * container, but only accept one if there
     * is exactly one button.
     *
     * This is deliberately conservative.
     */
    const buttons =
        container.locator(
            'button, [role="button"]',
        );

    const buttonCount =
        await buttons
            .count()
            .catch(() => 0);

    console.log(
        `DIRECT CONTACT BUTTONS IN CONTAINER: ${buttonCount}`,
    );

    if (
        buttonCount === 1
    ) {
        const button =
            buttons.first();

        if (
            await isVisible(button)
        ) {
            console.log(
                'DIRECT CONTACT: exactly one action button found; treating it as copy control.',
            );

            return button;
        }
    }

    /*
     * IMPORTANT:
     *
     * If there are multiple unidentified buttons,
     * do not guess.
     */
    if (
        buttonCount > 1
    ) {
        console.log(
            'DIRECT CONTACT: multiple unidentified buttons found; refusing to guess.',
        );
    }

    return null;
}

// ============================================================================
// CLIPBOARD
// ============================================================================

async function readClipboard(
    page: Page,
): Promise<string> {
    try {
        const value =
            await page.evaluate(
                async () => {
                    try {
                        return await navigator.clipboard.readText();
                    } catch {
                        return '';
                    }
                },
            );

        return normalizeText(value);
    } catch {
        return '';
    }
}

// ============================================================================
// DIRECT CONTACT EMAIL EXTRACTION
// ============================================================================

async function extractDirectContactEmail(
    page: Page,
): Promise<string | null> {
    console.log(
        'SEARCHING FOR EXACT "Direct Contact" SECTION...',
    );

    const heading =
        await findDirectContactHeading(
            page,
        );

    if (!heading) {
        console.log(
            'DIRECT CONTACT: NOT FOUND.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: SECTION FOUND.',
    );

    const container =
        await findDirectContactContainer(
            page,
            heading,
        );

    if (!container) {
        console.log(
            'DIRECT CONTACT: CONTAINER NOT FOUND.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: CONTAINER FOUND.',
    );

    const copyButton =
        await findDirectContactCopyButton(
            container,
        );

    if (!copyButton) {
        console.log(
            'DIRECT CONTACT: COPY BUTTON NOT FOUND.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: COPY BUTTON FOUND.',
    );

    /*
     * Clear the clipboard first.
     *
     * This is important because otherwise a failed
     * copy could leave an old email in the clipboard.
     */
    try {
        await page.evaluate(
            async () => {
                try {
                    await navigator.clipboard.writeText(
                        '',
                    );
                } catch {
                    // Ignore clipboard clearing failure.
                }
            },
        );
    } catch {
        // Ignore.
    }

    try {
        await copyButton.scrollIntoViewIfNeeded();

        await page.waitForTimeout(
            300,
        );

        console.log(
            'DIRECT CONTACT: CLICKING COPY BUTTON...',
        );

        const clicked =
            await safeClick(
                copyButton,
            );

        if (!clicked) {
            console.log(
                'DIRECT CONTACT: COPY BUTTON CLICK FAILED.',
            );

            return null;
        }
    } catch (error) {
        console.log(
            `DIRECT CONTACT: COPY ERROR: ${errorMessage(error)}`,
        );

        return null;
    }

    await page.waitForTimeout(
        DIRECT_CONTACT_WAIT_MS,
    );

    const clipboardText =
        await readClipboard(page);

    if (!clipboardText) {
        console.log(
            'DIRECT CONTACT: CLIPBOARD EMPTY.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT: CLIPBOARD CONTENT RECEIVED.',
    );

    const email =
        extractEmail(
            clipboardText,
        );

    if (!email) {
        console.log(
            'DIRECT CONTACT: CLIPBOARD DOES NOT CONTAIN AN EMAIL.',
        );

        return null;
    }

    console.log(
        `DIRECT CONTACT EMAIL FOUND: ${email}`,
    );

    return email;
}

// ============================================================================
// DISCOVERY
// ============================================================================

async function findProfileLinks(
    page: Page,
): Promise<string[]> {
    const hrefs =
        await page
            .locator(
                'a[href*="/name/nm"]',
            )
            .evaluateAll(
                (anchors) =>
                    anchors
                        .map(
                            (anchor) =>
                                (
                                    anchor as HTMLAnchorElement
                                ).href,
                        )
                        .filter(Boolean),
            )
            .catch(() => []);

    return [
        ...new Set(hrefs),
    ];
}

function buildPageUrl(
    startUrl: string,
    pageNumber: number,
): string {
    const url =
        new URL(startUrl);

    url.searchParams.set(
        'pageNumber',
        String(pageNumber),
    );

    return url.toString();
}

// ============================================================================
// PROCESS PROFILE
// ============================================================================

async function processProfile(
    context: BrowserContext,
    person: Person,
): Promise<DirectContactResult | null> {
    const page =
        await context.newPage();

    try {
        console.log('');
        console.log(
            '========================================',
        );
        console.log(
            `PROCESSING: ${person.imdbId}`,
        );
        console.log(
            `NAME: ${person.name}`,
        );
        console.log(
            `PROFILE: ${person.profileUrl}`,
        );
        console.log(
            '========================================',
        );

        try {
            await page.goto(
                person.profileUrl,
                {
                    waitUntil:
                        'domcontentloaded',
                    timeout: 60000,
                },
            );
        } catch (error) {
            console.log(
                `PROFILE NAVIGATION FAILED: ${errorMessage(error)}`,
            );

            return null;
        }

        await page.waitForTimeout(
            PROFILE_WAIT_MS,
        );

        console.log(
            `PROFILE ACTUAL URL: ${page.url()}`,
        );

        const currentUrl =
            page.url();

        if (
            /signin|login|ap\/signin/i.test(
                currentUrl,
            )
        ) {
            console.log(
                'PROFILE REDIRECTED TO LOGIN.',
            );

            return null;
        }

        /*
         * First try to find Direct Contact directly.
         *
         * We do not want to click arbitrary
         * representative/agent/manager controls.
         */
        let directHeading =
            await findDirectContactHeading(
                page,
            );

        /*
         * If Direct Contact is not currently visible,
         * look for the general contact control that
         * reveals the contact panel.
         */
        if (!directHeading) {
            console.log(
                'DIRECT CONTACT SECTION NOT YET VISIBLE.',
            );

            console.log(
                'SEARCHING FOR CONTACT CONTROL...',
            );

            const contactControl =
                await findContactControl(
                    page,
                );

            if (
                contactControl
            ) {
                console.log(
                    'CONTACT CONTROL FOUND. CLICKING...',
                );

                const clicked =
                    await safeClick(
                        contactControl,
                    );

                if (
                    clicked
                ) {
                    await page.waitForTimeout(
                        DIRECT_CONTACT_WAIT_MS,
                    );
                }
            } else {
                console.log(
                    'CONTACT CONTROL NOT FOUND.',
                );
            }

            directHeading =
                await findDirectContactHeading(
                    page,
                );
        }

        /*
         * Give the page a little more time if
         * the contact section is dynamically rendered.
         */
        if (!directHeading) {
            await page.waitForTimeout(
                1500,
            );

            directHeading =
                await findDirectContactHeading(
                    page,
                );
        }

        /*
         * FINAL RULE:
         *
         * If there is no exact Direct Contact
         * section, save NOTHING.
         */
        if (!directHeading) {
            console.log(
                'NO DIRECT CONTACT SECTION.',
            );

            console.log(
                'NOT SAVED.',
            );

            return null;
        }

        const email =
            await extractDirectContactEmail(
                page,
            );

        /*
         * FINAL RULE:
         *
         * Only a successful email copied from
         * Direct Contact is accepted.
         */
        if (!email) {
            console.log(
                'NO DIRECT CONTACT EMAIL WAS COPIED.',
            );

            console.log(
                'NOT SAVED.',
            );

            return null;
        }

        console.log(
            `DIRECT CONTACT CONFIRMED: ${email}`,
        );

        return {
            imdbId: person.imdbId,
            profileUrl:
                person.profileUrl,
            name: person.name,
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

// ============================================================================
// MAIN
// ============================================================================

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

    if (
        typeof input.startUrl !==
            'string' ||
        !input.startUrl.trim()
    ) {
        throw new Error(
            'Missing startUrl. The Actor input field is named "startUrl".',
        );
    }

    if (
        input.authState ===
            undefined ||
        input.authState ===
            null ||
        (
            typeof input.authState ===
                'string' &&
            !input.authState.trim()
        )
    ) {
        throw new Error(
            'Missing authState.',
        );
    }

    const parsedMaxPages =
        Number(
            input.maxPages ?? 0,
        );

    const parsedMaxProfiles =
        Number(
            input.maxProfiles ?? 0,
        );

    /*
     * In your Input schema:
     *
     * 0 = unlimited
     */
    const maxPages =
        parsedMaxPages > 0
            ? Math.floor(
                parsedMaxPages,
            )
            : Number.POSITIVE_INFINITY;

    const maxProfiles =
        parsedMaxProfiles > 0
            ? Math.floor(
                parsedMaxProfiles,
            )
            : Number.POSITIVE_INFINITY;

    console.log(
        `DISCOVERY URL: ${input.startUrl}`,
    );

    console.log(
        `MAX PAGES: ${
            Number.isFinite(maxPages)
                ? maxPages
                : 'UNLIMITED'
        }`,
    );

    console.log(
        `MAX PROFILES: ${
            Number.isFinite(maxProfiles)
                ? maxProfiles
                : 'UNLIMITED'
        }`,
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

    const context =
        await browser.newContext({
            storageState:
                authState as any,

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
        // ====================================================================
        // AUTHENTICATION CHECK
        // ====================================================================

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
                input.startUrl,
                {
                    waitUntil:
                        'domcontentloaded',
                    timeout: 60000,
                },
            );

            await authPage.waitForTimeout(
                3000,
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

        // ====================================================================
        // DISCOVERY
        // ====================================================================

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
                const discoveryUrl =
                    buildPageUrl(
                        input.startUrl,
                        pageNumber,
                    );

                console.log(
                    `OPENING: ${discoveryUrl}`,
                );

                try {
                    await discoveryPage.goto(
                        discoveryUrl,
                        {
                            waitUntil:
                                'domcontentloaded',
                            timeout: 60000,
                        },
                    );
                } catch (error) {
                    console.log(
                        `DISCOVERY NAVIGATION FAILED: ${errorMessage(error)}`,
                    );

                    continue;
                }

                await discoveryPage.waitForTimeout(
                    DISCOVERY_WAIT_MS,
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

                const people: Person[] =
                    profileLinks
                        .map(
                            (
                                href,
                            ) => {
                                const imdbId =
                                    extractImdbId(
                                        href,
                                    );

                                if (
                                    !imdbId
                                ) {
                                    return null;
                                }

                                return {
                                    imdbId,
                                    name: '',
                                    profileUrl:
                                        `https://pro.imdb.com/name/${imdbId}/`,
                                };
                            },
                        )
                        .filter(
                            (
                                person,
                            ): person is Person =>
                                person !== null,
                        );

                console.log(
                    `VALID PROFILES FOUND: ${people.length}`,
                );

                for (
                    const person of people
                ) {
                    if (
                        totalProcessed >=
                        maxProfiles
                    ) {
                        break;
                    }

                    if (
                        processedIds.has(
                            person.imdbId,
                        )
                    ) {
                        continue;
                    }

                    processedIds.add(
                        person.imdbId,
                    );

                    totalProcessed++;

                    /*
                     * processProfile opens the actual
                     * IMDbPro profile and extracts the
                     * profile name + Direct Contact.
                     */
                    const profilePage =
                        await context.newPage();

                    let result:
                        DirectContactResult | null =
                        null;

                    try {
                        console.log('');
                        console.log(
                            `PROCESSING PROFILE ${totalProcessed}`,
                        );
                        console.log(
                            `IMDb ID: ${person.imdbId}`,
                        );
                        console.log(
                            `URL: ${person.profileUrl}`,
                        );

                        try {
                            await profilePage.goto(
                                person.profileUrl,
                                {
                                    waitUntil:
                                        'domcontentloaded',
                                    timeout: 60000,
                                },
                            );
                        } catch (error) {
                            console.log(
                                `PROFILE NAVIGATION FAILED: ${errorMessage(error)}`,
                            );

                            continue;
                        }

                        await profilePage.waitForTimeout(
                            PROFILE_WAIT_MS,
                        );

                        const profileName =
                            await getProfileName(
                                profilePage,
                            );

                        person.name =
                            profileName ||
                            person.imdbId;

                        console.log(
                            `PROFILE NAME: ${person.name}`,
                        );

                        const email =
                            await extractDirectContactEmail(
                                profilePage,
                            );

                        /*
                         * If Direct Contact was not already
                         * visible, try the contact control once.
                         */
                        if (!email) {
                            console.log(
                                'DIRECT CONTACT EMAIL NOT FOUND ON INITIAL CHECK.',
                            );

                            const contactControl =
                                await findContactControl(
                                    profilePage,
                                );

                            if (
                                contactControl
                            ) {
                                console.log(
                                    'CONTACT CONTROL FOUND. CLICKING TO RECHECK DIRECT CONTACT...',
                                );

                                const clicked =
                                    await safeClick(
                                        contactControl,
                                    );

                                if (
                                    clicked
                                ) {
                                    await profilePage.waitForTimeout(
                                        DIRECT_CONTACT_WAIT_MS,
                                    );
                                }
                            }

                            const retryEmail =
                                await extractDirectContactEmail(
                                    profilePage,
                                );

                            if (
                                retryEmail
                            ) {
                                result = {
                                    imdbId:
                                        person.imdbId,
                                    profileUrl:
                                        person.profileUrl,
                                    name:
                                        person.name,
                                    email:
                                        retryEmail,
                                };
                            }
                        } else {
                            result = {
                                imdbId:
                                    person.imdbId,
                                profileUrl:
                                    person.profileUrl,
                                name:
                                    person.name,
                                email,
                            };
                        }
                    } catch (error) {
                        console.log(
                            `PROFILE ERROR: ${errorMessage(error)}`,
                        );
                    } finally {
                        await profilePage
                            .close()
                            .catch(
                                () => {},
                            );
                    }

                    /*
                     * ========================================================
                     * DATASET SAFETY RULE
                     * ========================================================
                     *
                     * ONLY push when:
                     *
                     * 1. Direct Contact section was found.
                     * 2. Direct Contact copy button was clicked.
                     * 3. Clipboard contained an email.
                     *
                     * No email = NO DATASET ROW.
                     */
                    if (!result) {
                        console.log(
                            'NO VALID DIRECT CONTACT EMAIL.',
                        );

                        console.log(
                            'NOT SAVED TO DATASET.',
                        );

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
                        `NAME: ${result.name}`,
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

    await Actor.exit(
        `Finished. Saved ${totalSaved} Direct Contact records.`,
    );
}

main().catch(
    async (error) => {
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
    },
);
```
