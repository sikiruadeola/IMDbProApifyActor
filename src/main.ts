// build-cache-bust: 1788659661
import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from 'playwright';

interface Input {
    startUrl: string;
    authState?: unknown;
    maxPages?: number;
    maxProfiles?: number;
}

interface Person {
    imdbId: string;
    name: string;
    profileUrl: string;
    discoveryPage: number;
}

interface DirectContactResult {
    raw: string | null;
    status: 'found' | 'not_found' | 'no_copy_button' | 'no_email' | 'leaked' | 'error';
    error: string | null;
}

interface PersonRecord {
    discoveryPage: number;
    directContactRaw: string;
}

// Paste your own exported Playwright storage state JSON here between the
// backticks. Once this is filled in, nobody running this actor needs to
// supply their own session, it will be used automatically unless the
// authState input field is filled in for a specific run.
const EMBEDDED_AUTH_STATE_B64 = `ewogICJjb29raWVzIjogWwogICAgewogICAgICAibmFtZSI6ICJhdC1BVFZQREtJS1gwREVSIiwKICAgICAgInZhbHVlIjogIkF0emF8Z1FDeDh5M1lBd0VCQUlkYWxxUmZFMm1zeldzUXNTR3ZEU2Y1SnNmQnhBYnZrU3JXV3hpNFlmSm5IbkxNOVE0TmlCR09IdlE5NFVhQlJUdGI3eklOYmFWaHd4YlpaS3hGNEhaT0JkdTI3SkdKM2paTTAycExFdkVFVkZBM1ZGMTl6Z05KTGR5VkxxRWVYRTBoZ2R2QnJOUk5XdkVFdnR0NGRuN3BLVVR2cE15M3FyRmtLMXo4dTBoWHVBV0ozQmNxdFA4dkpOZlpuWFhFNHlHRTN6M1lQWWR4RWJPRkZ5UjNrQzlrT05PMGNGaEJGX0xfcUFyVE04T204bmctUjZaR0xvVjZRRTVtanpZX09qamdoaF9hNmZia1B1b1hhWno0SmhTcHRmbmk1aVVIMmNpS2RLeXE4OFpYNjQ3TklaeEZ5Tm1iRDd2ZDBfQTFSN2pwR3lleFFCclNtZE9uR0h3MzFUTWw5UDVGZDdUT1FnU095R2dEMU50dkpWUTdVbVhKWTJtVUxkQlRfMFNZS00yaVVxSE90UHFtZUVJUzRWWWhsQjlwUWNpY0NqSSIsCiAgICAgICJkb21haW4iOiAiLnd3dy5hbWF6b24uY29tIiwKICAgICAgInBhdGgiOiAiL2FwIiwKICAgICAgImV4cGlyZXMiOiAtMSwKICAgICAgImh0dHBPbmx5IjogdHJ1ZSwKICAgICAgInNlY3VyZSI6IHRydWUsCiAgICAgICJzYW1lU2l0ZSI6ICJMYXgiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJzZXNzLWF0LUFUVlBES0lLWDBERVIiLAogICAgICAidmFsdWUiOiAiMUVvVUpaOWhZWHJhMTFSMmZwUEdoei9YNStFUFUraHNkTjVJUnFBcndhVT0iLAogICAgICAiZG9tYWluIjogIi53d3cuYW1hem9uLmNvbSIsCiAgICAgICJwYXRoIjogIi9hcCIsCiAgICAgICJleHBpcmVzIjogLTEsCiAgICAgICJodHRwT25seSI6IHRydWUsCiAgICAgICJzZWN1cmUiOiB0cnVlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAidXUiLAogICAgICAidmFsdWUiOiAiZXlKcFpDSTZJblYxWW1GbU5qTmpZall3WWpkbU5EazFPR0l3WmpZaUxDSndjbVZtWlhKbGJtTmxjeUk2ZXlKbWFXNWtYMmx1WTJ4MVpHVmZZV1IxYkhRaU9tWmhiSE5sZlgwPSIsCiAgICAgICJkb21haW4iOiAiLmltZGIuY29tIiwKICAgICAgInBhdGgiOiAiLyIsCiAgICAgICJleHBpcmVzIjogMTgyMjkxNzAwOS4xNDMzNjQsCiAgICAgICJodHRwT25seSI6IGZhbHNlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogInNlc3Npb24taWQiLAogICAgICAidmFsdWUiOiAiMTM2LTQ0NDg3MzktODI0Mjc2NCIsCiAgICAgICJkb21haW4iOiAiLmltZGIuY29tIiwKICAgICAgInBhdGgiOiAiLyIsCiAgICAgICJleHBpcmVzIjogMTgyMjkxNzMzMi41NjE0NDUsCiAgICAgICJodHRwT25seSI6IGZhbHNlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogInViaWQtbWFpbiIsCiAgICAgICJ2YWx1ZSI6ICIxMzEtODIyNTk0NS02Njg4NzA0IiwKICAgICAgImRvbWFpbiI6ICIuaW1kYi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE5ODkzMjIwLjEyNzY5OSwKICAgICAgImh0dHBPbmx5IjogZmFsc2UsCiAgICAgICJzZWN1cmUiOiB0cnVlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAiYXdzLXdhZi10b2tlbiIsCiAgICAgICJ2YWx1ZSI6ICI1ZjdhOGZjNC1lOWQ2LTQ3MGMtYmQ1ZS1kOWExYTE0MTUzYTY6RVFvQXFrbGdWOENkQUFBQTo4cERUL2c0UVZXWlVlNDNrNGt5NEZJNk5CY0pPSEJPcWF2U0tmaTdEcitHZEtqRVdSTElxcldmVVpRZjdMTmpVRWN5dFFYM2luSEozMnRCczZGMVhtMUxIUzROenhzS3R4VENLQzl4aHgwRThwVzdaL1kwM0d5RTlXL09iMUZqU2JPem5vYmVxcTNaUDlPcWRsS1k4M2JENGtOMk1jeWExSWI2MjBod3BlV1ZhcE5Uc1JUeEpvU09DTUNyaXI4SDF4czFXaERrQTVrNVcyTWVUV2dKMWpQNFIrY21HYXMwakhld1RxUWNlRUNvK0ZjVzB0VHViTFpNYzZiMGdtc1RrVmpwemxGRWdBcVQrQU02L0d1d1ZKUzRJc3lIdlhyMkhoNkxaOHpJZGZ1YXV3OXpxZ053VHhPZUZrZFBRQlRlemNkRWNjdjk3aTYzTElvaFAiLAogICAgICAiZG9tYWluIjogIi5pbWRiLmNvbSIsCiAgICAgICJwYXRoIjogIi8iLAogICAgICAiZXhwaXJlcyI6IDE3ODg3MDI2NDAsCiAgICAgICJodHRwT25seSI6IGZhbHNlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogInNlc3Npb24taWQiLAogICAgICAidmFsdWUiOiAiMTM1LTI4NjQ0NzYtMTcxMTkxNyIsCiAgICAgICJkb21haW4iOiAiLmFtYXpvbi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE5ODkzMjE5LjQ2NTQwNywKICAgICAgImh0dHBPbmx5IjogZmFsc2UsCiAgICAgICJzZWN1cmUiOiB0cnVlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAic3N0LW1haW4iLAogICAgICAidmFsdWUiOiAiU3N0MXxQUUp5QVRWb0N6WTZlSmpFN3VMX1Fmd3ZCdzdySnJkY0w2djIyanpiWmZ2V2l6WUJ0QzhCZVVQV2N0YUhXWGVNRm93S0tUZF9QQkNMVFZLclVwMl9FSC1uV2M1QUtOZml2c0gyQ1c0Y2hTOVdrZnRUMHFEZVQwaWJGbzRHaklmV2NrdHRzTHgydG5xUkJVYlZxZ0hVVUVhY0cyY19EWnUwUUlvQlY2MjdNWTViYm8yLXNLMmZxYkRmQ0tzWU9zX0ktdVJDQUpHbW00MHF6aU1aRExJYnFBMWh5SWpnc0lvQk01WmRuNkd3M3k2WXQxdjhNLWw2R3hkTnVUY2hNZlNLNi10NCIsCiAgICAgICJkb21haW4iOiAiLmFtYXpvbi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE5ODkzMjE5LjQ2NzI5MywKICAgICAgImh0dHBPbmx5IjogdHJ1ZSwKICAgICAgInNlY3VyZSI6IHRydWUsCiAgICAgICJzYW1lU2l0ZSI6ICJMYXgiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJpZF9wa2VsIiwKICAgICAgInZhbHVlIjogIm4wIiwKICAgICAgImRvbWFpbiI6ICJ3d3cuYW1hem9uLmNvbSIsCiAgICAgICJwYXRoIjogIi8iLAogICAgICAiZXhwaXJlcyI6IDE3ODgzNTgxMTAsCiAgICAgICJodHRwT25seSI6IGZhbHNlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIlN0cmljdCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogImlkX3BrIiwKICAgICAgInZhbHVlIjogImV5SnVJam9pTUNJc0ltTmpJam9pTVNKOSIsCiAgICAgICJkb21haW4iOiAid3d3LmFtYXpvbi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxNzg4MzU4MTE3LAogICAgICAiaHR0cE9ubHkiOiBmYWxzZSwKICAgICAgInNlY3VyZSI6IHRydWUsCiAgICAgICJzYW1lU2l0ZSI6ICJTdHJpY3QiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJ1YmlkLW1haW4iLAogICAgICAidmFsdWUiOiAiMTMwLTM1MjQ5MzctMzA0Nzc0NSIsCiAgICAgICJkb21haW4iOiAiLmFtYXpvbi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE5ODkzMjE5LjQ2NjQ2MSwKICAgICAgImh0dHBPbmx5IjogZmFsc2UsCiAgICAgICJzZWN1cmUiOiB0cnVlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAibGMtbWFpbiIsCiAgICAgICJ2YWx1ZSI6ICJlbl9VUyIsCiAgICAgICJkb21haW4iOiAiLmFtYXpvbi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE5ODkzMjA5Ljg0ODgzNiwKICAgICAgImh0dHBPbmx5IjogZmFsc2UsCiAgICAgICJzZWN1cmUiOiB0cnVlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAiY3NtLWhpdCIsCiAgICAgICJ2YWx1ZSI6ICJ0YjpWOUUwR1YyRjkzR1k0RUM2MDVKQStzLVo1MFA4MEJZVE1CQTAwRVFXR05RfDE3ODgzNTcyMTI1MTUmdDoxNzg4MzU3MjEyNTE1JmFkYjphZGJsa19ubyIsCiAgICAgICJkb21haW4iOiAid3d3LmFtYXpvbi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE4NTk3MjEyLAogICAgICAiaHR0cE9ubHkiOiBmYWxzZSwKICAgICAgInNlY3VyZSI6IGZhbHNlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAic2Vzc2lvbi1pZC10aW1lIiwKICAgICAgInZhbHVlIjogIjE4MTk4OTMwMTFsIiwKICAgICAgImRvbWFpbiI6ICIuYW1hem9uLmNvbSIsCiAgICAgICJwYXRoIjogIi8iLAogICAgICAiZXhwaXJlcyI6IDE4MTk4OTMyMTkuNDY1OTMsCiAgICAgICJodHRwT25seSI6IGZhbHNlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogInNlc3Npb24tdG9rZW4iLAogICAgICAidmFsdWUiOiAiN2YwVzBmVVVYSkZPTFhZQ253V2UvVUZaWTUvZlkyMlpCak85bnVHUEZ0SG9lU2JhMGJqUk8xQWRBNEdLOENKTWZkV1UzMEpCL0xDd1hQYlQxenhlbkJtUkpHOWVKTnc3a2FPYXhRTWRLQVZvdTRndkZNdE5wYnVPcXpZQkRRQjZmNmlLYWY3bFRuSWlEbkt6Y3NNdTNmaCtrR0ZRYjRBZy9pWjdMUk83QTRZMlI3RHBpY1JFemMvWW1RSFpHZVdvTStmWC9vQkxWRitQczBUcVRieFRmejFSTWRveGFRb0siLAogICAgICAiZG9tYWluIjogIi5hbWF6b24uY29tIiwKICAgICAgInBhdGgiOiAiLyIsCiAgICAgICJleHBpcmVzIjogMTgxOTg5MzIxOS40NjY5OTMsCiAgICAgICJodHRwT25seSI6IGZhbHNlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogInNzdC1tYWluIiwKICAgICAgInZhbHVlIjogIlNzdDF8UFFMc3RONDlNMF9sSVZXdHNZV0swNmNrQjQzWTQ5dUQwTUtUMWxNeDdPMktITU1WZ08ydDFlSW1ReTBtOFh2eXZubGhEd01aMkJCbW1yX1JvUFEtbFJrVUxmMzR4bDJsQ2FPNXZHZXptVm14TDNSRTktckppU0FBT3NwNFA4Y09ob1h3aEVSVS1BRzJPU1hOQzRybFRKRlBsSGZOZFNROEdfZkYxUnZ6djFRTGJ6QndkWnJYTVByc2dUYzM5ZDItWVBkb0RIdzJQVWt4MUh1a1ZYVXFHY2pSaVk3UVJqWkNhME1hT1R3VkNFWjlaTFFPbjdEaVU2NUhaeXptTy1GVDIza1UiLAogICAgICAiZG9tYWluIjogIi5pbWRiLmNvbSIsCiAgICAgICJwYXRoIjogIi8iLAogICAgICAiZXhwaXJlcyI6IDE4MTk4OTMyMjAuMTI4MTU4LAogICAgICAiaHR0cE9ubHkiOiB0cnVlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogIngtbWFpbiIsCiAgICAgICJ2YWx1ZSI6ICJDOWlQUkJucHZGZEpAc1FBT1l2dlhmekhrbjBVYkxRQzl6RTZDVVdXaVFwNVV2Y1pYaEZ0UGlYNHhRSWtuOHhOIiwKICAgICAgImRvbWFpbiI6ICIuaW1kYi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE5ODkzMjIwLjEyOTYyOSwKICAgICAgImh0dHBPbmx5IjogZmFsc2UsCiAgICAgICJzZWN1cmUiOiB0cnVlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAiYXQtbWFpbiIsCiAgICAgICJ2YWx1ZSI6ICJBdHphfGdRQ3g4eTNZQXdFQkFJZGFscVJmRTJtc3pXc1FzU0d2RFNmNUpzZkJ4QWJ2a1NyV1d4aTRZZkpuSG5MTTlRNE5pQkdPSHZROTRVYUJSVHRiN3pJTmJhVmh3eGJaWkt4RjRIWk9CZHUyN0pHSjNqWk0wMnBMRXZFRVZGQTNWRjE5emdOSkxkeVZMcUVlWEUwaGdkdkJyTlJOV3ZFRXZ0dDRkbjdwS1VUdnBNeTNxckZrSzF6OHUwaFh1QVdKM0JjcXRQOHZKTmZablhYRTR5R0UzejNZUFlkeEViT0ZGeVIza0M5a09OTzBjRmhCRl9MX3FBclRNOE9tOG5nLVI2WkdMb1Y2UUU1bWp6WV9PampnaGhfYTZmYmtQdW9YYVp6NEpoU3B0Zm5pNWlVSDJjaUtkS3lxODhaWDY0N05JWnhGeU5tYkQ3dmQwX0ExUjdqcEd5ZXhRQnJTbWRPbkdIdzMxVE1sOVA1RmQ3VE9RZ1NPeUdnRDFOdHZKVlE3VW1YSlkybVVMZEJUXzBTWUtNMmlVcUhPdFBxbWVFSVM0VllobEI5cFFjaWNDakkiLAogICAgICAiZG9tYWluIjogIi5pbWRiLmNvbSIsCiAgICAgICJwYXRoIjogIi8iLAogICAgICAiZXhwaXJlcyI6IDE4MTk4OTMyMjAuMTI5ODk3LAogICAgICAiaHR0cE9ubHkiOiB0cnVlLAogICAgICAic2VjdXJlIjogdHJ1ZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogInNlc3MtYXQtbWFpbiIsCiAgICAgICJ2YWx1ZSI6ICIxRW9VSlo5aFlYcmExMVIyZnBQR2h6L1g1K0VQVStoc2RONUlScUFyd2FVPSIsCiAgICAgICJkb21haW4iOiAiLmltZGIuY29tIiwKICAgICAgInBhdGgiOiAiLyIsCiAgICAgICJleHBpcmVzIjogMTgxOTg5MzIyMC4xMzAyMiwKICAgICAgImh0dHBPbmx5IjogdHJ1ZSwKICAgICAgInNlY3VyZSI6IHRydWUsCiAgICAgICJzYW1lU2l0ZSI6ICJMYXgiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJzZXNzaW9uLWlkLXRpbWUiLAogICAgICAidmFsdWUiOiAiMjA4Mjc4NzIwMWwiLAogICAgICAiZG9tYWluIjogIi5pbWRiLmNvbSIsCiAgICAgICJwYXRoIjogIi8iLAogICAgICAiZXhwaXJlcyI6IDE4MjI5MTczMzIuNTYyNjc1LAogICAgICAiaHR0cE9ubHkiOiBmYWxzZSwKICAgICAgInNlY3VyZSI6IHRydWUsCiAgICAgICJzYW1lU2l0ZSI6ICJMYXgiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJsb2ctbWFpbiIsCiAgICAgICJ2YWx1ZSI6ICI5MDZiNzE4OC1mMTVkLTQ2YjMtODNlMy00NDBiNTAwNGNjZWMiLAogICAgICAiZG9tYWluIjogIi5pbWRiLmNvbSIsCiAgICAgICJwYXRoIjogIi8iLAogICAgICAiZXhwaXJlcyI6IDE3ODgzNjgwMjAuNjIyMDg1LAogICAgICAiaHR0cE9ubHkiOiBmYWxzZSwKICAgICAgInNlY3VyZSI6IHRydWUsCiAgICAgICJzYW1lU2l0ZSI6ICJMYXgiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJjaSIsCiAgICAgICJ2YWx1ZSI6ICJleUpoWTNRaU9pSkRVWEIzYm10QlVYQjNibXRCUmpSQlFrTkZUbWcyTFdkQlFVRkJRVUZCUVVGQ1lXMUhPRkZDTWtkdmMwNVVOR0YwYUhKRVJGaDFSM2RaWWtSM01sUkVXbVZITUZsaWQwRkJSVUZCUVVGQklpd2laMk4wSWpvaVExRndkMjVyUVZGd2QyNXJRVVkwUVVKRFJVNURja1puUVU1TVFVRkJRVUZCUW1GblREUjNWMUZCUmxGQlRVRkJNRUZEYjBGSFVVRlBRVUZuWjBKSlFVVnZRVXAzUVZaQlFYUkJRbXhCUkZGQlRsRkJZMmRCT1VGQ0xVRkZTMEZKYjBGcVVVSk5RVVUwUVV0QlFWVm5RWEZCUW1SblJFTkJUVlZCWWtGQ2RXZEVhMEZQV1VGbVFVRmZRVU5CUVVWSlFVbHBRVkozUWtoblEyRkJSbUZCVEdkQllXOUJOa0ZDTkdkRU9XZEpaMEZwU1VKRmQwTk1VVVZqUVZJd1FXdDNRa3RuUTFkblJYZEJTbmRCVkhOQmNHOUNWMUZEZGtGSFMwRk5Oa0ZhT0VFMFVVSjRRVVF0UVVsdFFWSnhRV293UWxKdlEzQlJSbkpCVEhSQldHMUJkbU5DWmpSRVFWRkhTMEZOVjBGYVdVRjZORUowYjBSblFVaFdaMUJOUVdaalFWOXpRMEZKUlVkblNWQm5VbTVCYW5OQ1NHOURWbGxHVFdkTVZFRllTMEYyYVVGQlJVRkJRWE5HUVVKblFVTkVOa0ZUUVVSQlFVVklNRUl3UVVkQlFVbFFiMFZ2UVUxQlFWRm1VVXRSUVZsQlFXY3RaMGRCUVhkQlFrSTVRVlZCUW1kQlEwUTJRWGRCUkVGQlJVZ3dRMEZCUjBGQlNWQnZRMEZCUWxsQlJFRkJSVWd3UVVFdVNVdzBkMWRSUVVaUlFVMUJRVEJCUTI5QlIxRkJUMEZCWjJkQ1NVRkZiMEZLZDBGV1FVRjBRVUpzUVVSUlFVNVJRV05uUVRsQlFpMUJSVXRCU1c5QmFsRkNUVUZGTkVGTFFVRlZaMEZ4UVVKa1owUkRRVTFWUVdKQlFuVm5SR3RCVDFsQlprRkJYMEZEUVVGRlNVRkphVUZTZDBKSVowTmhRVVpoUVV4blFXRnZRVFpCUWpSblJEbG5TV2RCYVVsQ1JYZERURkZGWTBGU01FRnJkMEpMWjBOWFowVjNRVXAzUVZSelFYQnZRbGRSUTNaQlIwdEJUVFpCV2poQk5GRkNlRUZFTFVGSmJVRlNjVUZxTUVKU2IwTndVVVp5UVV4MFFWaHRRWFpqUW1ZMFJFRlJSMHRCVFZkQldsbEJlalJDZEc5RVowRklWbWRRVFVGbVkwRmZjME5CU1VWSFowbFFaMUp1UVdwelFraHZRMVpaUmsxblRGUkJXRXRCZG1sQkxtTkJRVUZCUVVGQlFVRkJJaXdpY0hWeWNHOXpaWE1pT2xzaU1TSXNJaklpTENJMElpd2lOeUlzSWpraUxDSXhNQ0lzSWpFeElsMHNJblpsYm1SdmNuTWlPbHNpTmpnaUxDSTNOeUlzSWpjMU5TSXNJamM1TXlJc0lqZ3dOQ0lzSWpFeE1qWWlMQ0kxTURBeU5TSXNJalV3TURJNUlpd2lOVEF3TXpBaUxDSTFNREF6T0NKZExDSmhaMlZUYVdkdVlXd2lPaUpCUkZWTVZDSXNJbWx6UjJSd2NpSTZkSEoxWlgwIiwKICAgICAgImRvbWFpbiI6ICIuaW1kYi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAtMSwKICAgICAgImh0dHBPbmx5IjogZmFsc2UsCiAgICAgICJzZWN1cmUiOiBmYWxzZSwKICAgICAgInNhbWVTaXRlIjogIkxheCIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogIl9nY2xfYXUiLAogICAgICAidmFsdWUiOiAiMS4xLjcwMDE5ODU0NC4xNzg4MzU3MjI5IiwKICAgICAgImRvbWFpbiI6ICIuaW1kYi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxNzk2MTMzMjI4LAogICAgICAiaHR0cE9ubHkiOiBmYWxzZSwKICAgICAgInNlY3VyZSI6IGZhbHNlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfSwKICAgIHsKICAgICAgIm5hbWUiOiAic2Vzc2lvbi10b2tlbiIsCiAgICAgICJ2YWx1ZSI6ICJPb3N5SmtSNXVIQjcydmFXbmRzMEQ4blJRMll3YWlpK1NIejV6U0dOeVY4SHNmZzc2MTZkRkFicjZ2T2pzNmlzSW1iMTFlVnY5eGdzYk1CZGVBSmYvOS80WklaOFZhR3JudjFFQ3hMN2s3TldUMjJhZXg3S1A2NXV1U1pNY200SXd1UlhDK0VCVnE4WkkrYUhYejBNQTlTMWU0SEJ3SEZCVVZHOW9LSkljZE9GTnFmMnRNeGNGUFZRS1l6NjY2NGVtWWlIQ3NnQmdoNUZxTGFnNlVJeURCekZoTUdQc21ETlNUUnB1K2lhLzFDRjZNU1JFNnRiNWFrYkVFV01TNlJUIiwKICAgICAgImRvbWFpbiI6ICIuaW1kYi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODIyOTE3MzMyLjU2MzI3NSwKICAgICAgImh0dHBPbmx5IjogdHJ1ZSwKICAgICAgInNlY3VyZSI6IHRydWUsCiAgICAgICJzYW1lU2l0ZSI6ICJMYXgiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJjc20taGl0IiwKICAgICAgInZhbHVlIjogInRiOnMtU01UNURTUkhYWkRFWFZBQkQ4V0R8MTc4ODM1NzMzMjc0NSZ0OjE3ODgzNTczMzM0MjAmYWRiOmFkYmxrX25vIiwKICAgICAgImRvbWFpbiI6ICJwcm8uaW1kYi5jb20iLAogICAgICAicGF0aCI6ICIvIiwKICAgICAgImV4cGlyZXMiOiAxODE4NTk3MzMzLAogICAgICAiaHR0cE9ubHkiOiBmYWxzZSwKICAgICAgInNlY3VyZSI6IGZhbHNlLAogICAgICAic2FtZVNpdGUiOiAiTGF4IgogICAgfQogIF0sCiAgIm9yaWdpbnMiOiBbCiAgICB7CiAgICAgICJvcmlnaW4iOiAiaHR0cHM6Ly9wcm8uaW1kYi5jb20iLAogICAgICAibG9jYWxTdG9yYWdlIjogWwogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImF3c193YWZfdG9rZW5fY2hhbGxlbmdlX2F0dGVtcHRzIiwKICAgICAgICAgICJ2YWx1ZSI6ICJ7XCJhdHRlbXB0c1wiOjEsXCJsYXN0QXR0ZW1wdFRpbWVzdGFtcFwiOjE3ODgzNTcwMDg3MzN9IgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm5hbWUiOiAiY3NhLWN0b2tlbi0ySFYwRTBEUzRXTkFLQzZFTTVZWSIsCiAgICAgICAgICAidmFsdWUiOiAiMTc4ODM2MDY0NDMyMSIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImNzbS1iZiIsCiAgICAgICAgICAidmFsdWUiOiAiW1wiU01UNURTUkhYWkRFWFZBQkQ4V0RcIixcIkJRREZFTTI0TlZKMzBNOUZXUVpBXCIsXCJaQllENzhDWkVZNkJLMVRWOVY5WlwiLFwiSkI3NkQ3OVNIQjFFVlNRUEZDSkpcIixcIkNWOEdESEtRM1ROWDlEWkNFWTRZXCIsXCIySFYwRTBEUzRXTkFLQzZFTTVZWVwiXSIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImEtZm9udC1jbGFzcyIsCiAgICAgICAgICAidmFsdWUiOiAiYS1lbWJlciBhLWVtYmVyLTEtMC0wIGEtZW1iZXItbW9kZXJuLWRpc3BsYXkgYS1lbWJlci1tb2Rlcm4tZGlzcGxheS0xLTAtMCBhLWVtYmVyLW1vZGVybi10ZXh0IGEtZW1iZXItbW9kZXJuLXRleHQtMS0wLTAiCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibmFtZSI6ICJjc2EtY3Rva2VuLVNNVDVEU1JIWFpERVhWQUJEOFdEIiwKICAgICAgICAgICJ2YWx1ZSI6ICIxNzg4MzYwOTMzNDUzIgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm5hbWUiOiAiY3NtOmFkYiIsCiAgICAgICAgICAidmFsdWUiOiAiYWRibGtfbm8iCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibmFtZSI6ICJhd3N3YWZfY2FwdGNoYV9zb2x2ZV90aW1lc3RhbXAiLAogICAgICAgICAgInZhbHVlIjogIjE3ODgzNTcwNDA4ODMiCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibmFtZSI6ICJhd3N3YWZfc2Vzc2lvbl9zdG9yYWdlIiwKICAgICAgICAgICJ2YWx1ZSI6ICI1ZjdhOGZjNC1lOWQ2LTQ3MGMtYmQ1ZS1kOWExYTE0MTUzYTY6RVFvQXFrbGdWeU9WQUFBQTpQMElMVFNEd1dPNlN0OXc1R2g2b2lsVm5NYkppWTFsRHVNNjR1TnFqYnh1SnhKR0xjM1JwSmNhNmdWUGN6ZXJXdmdYU1NLclQ3dkl2c2E2cWNlQjJnWXc1TThJNU5DK2lRUFdUYjNPK24xRWhlTlo3R3BLM1JrQkx2QloyQVdiRUU4UkloRHZOaFpSc21CRk1LUG1rNFhvclBXb1lwSWt3VmhHQ25KeTkyOXZzR0ZocXhIRmxaWGpUVzRMcS8zUzlIWmZOUlNwckxrL1VaVEVQa0RvWUxRV2NUSVlTNGlUYkxvd2gvSXZMZXk2M1h2azNJa2k0TVY0UnE5OUF1T3lMelNuSGRoUmUzSE12RjFnRVhtUDlyY3FRdG5UM0RjUmwrdXhKeFRjaHRoMGxpVWkzb3hWVkwya2d6Qm8yOGNCRlhYMmJOVFZVTHRmRHVucVhkd3BLa2RHUi9rU2xXclZIT0JzZUhjaEpCL0FKcHByMWROMlNDVHM0UVJENDZ2d3RSeVMyb1NoNVpROVh1SkVNWHl2aHUzMXBxRk9RcnpxR2NjZVpHbXVhZ2tXNVM2RnhtTkhlYXFxUW1pU3Y2VUZjN21VMU5McU9CcW5sNzlET1Z5Rkxsc3JRQ1RoZFZUdXV1RjF6MlU0K1NkdVhVVXNQRS9icVRWRWNwWldieWxpTklKd05sczVHeVFRR21xU2g5UHNSQmtEUC9DWnFMeDN5Tlp1L3VBeWRMUGFQNlRKOGVYV01XelVqM2tqMXR4b0pJdm1oVmRvS0FuQjBVVGpEVG9QTUdKSnM1dz09IgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm5hbWUiOiAiX2djbF9scyIsCiAgICAgICAgICAidmFsdWUiOiAie1wic2NoZW1hXCI6XCJnY2xcIixcInZlcnNpb25cIjoxLFwiZ3NpZF9kY1wiOntcInZhbHVlXCI6e1wiam9pbklkXCI6XCJCdEFwekFSU2NDNVVvTFIwcVhUc3FfSzNUdHgzUnExbzJRXCIsXCJsYXN0Sm9pbmVkVGltZU1zXCI6MTc4ODM1NzIyODgxOH0sXCJleHBpcmVzXCI6MTc4ODM1NzUyODgxOH0sXCJnY2xfY3RyXCI6e1widmFsdWVcIjp7XCJ2YWx1ZVwiOjAsXCJ0aW1lb3V0c1wiOjAsXCJlcnJvcnNcIjowLFwiZW9wQ291bnRcIjowLFwiY3JlYXRpb25UaW1lTXNcIjoxNzg4MzU3MjI4ODI1fSxcImV4cGlyZXNcIjoxNzk2MTMzMjI4ODI1fSxcImxhc3RfY29udnNcIjp7XCJ2YWx1ZVwiOltdLFwiZXhwaXJlc1wiOjE3OTYxMzMyMjg4MjV9fSIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImNzYS10YWJiZWQtYnJvd3NpbmciLAogICAgICAgICAgInZhbHVlIjogIntcImxhc3RBY3RpdmVcIjp7XCJ2aXNpYmxlXCI6dHJ1ZSxcInBpZFwiOlwiemhrZXkwLTl3MG16Ny00aGl0NmkteWxpNGlwXCIsXCJ0aWRcIjpcInRwdzMzMC12eHQ1cGgtbnI1bzFlLXFxN2RlZ1wiLFwiZW50XCI6e1wicmlkXCI6XCJTTVQ1RFNSSFhaREVYVkFCRDhXRFwiLFwiZXR5XCI6XCJuYW1lXCIsXCJlc3R5XCI6XCJjb250YWN0c1wifX0sXCJsYXN0SW50ZXJhY3Rpb25cIjp7XCJpZFwiOlwidzVsZ2dtLXJjM3Z3YS04YjA3NjEtOXNyYWE2XCIsXCJ1c2VkXCI6dHJ1ZX0sXCJ0aW1lXCI6MTc4ODM1NzMzMzQ1OSxcImluaXRpYWxpemVkXCI6dHJ1ZX0iCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibmFtZSI6ICJjc2EtY3Rva2VuLUJRREZFTTI0TlZKMzBNOUZXUVpBIiwKICAgICAgICAgICJ2YWx1ZSI6ICIxNzg4MzYwODk5OTE3IgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm5hbWUiOiAiY3NhLWN0b2tlbi1KQjc2RDc5U0hCMUVWU1FQRkNKSiIsCiAgICAgICAgICAidmFsdWUiOiAiMTc4ODM2MDgyNDUzOCIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImNzYS1jdG9rZW4tQ1Y4R0RIS1EzVE5YOURaQ0VZNFkiLAogICAgICAgICAgInZhbHVlIjogIjE3ODgzNjA3NTU3MTUiCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibmFtZSI6ICJhd3N3YWZfdG9rZW5fcmVmcmVzaF90aW1lc3RhbXAiLAogICAgICAgICAgInZhbHVlIjogIjE3ODgzNTcwMTA4OTMiCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibmFtZSI6ICJjc20taGl0IiwKICAgICAgICAgICJ2YWx1ZSI6ICJ0YjpzLVNNVDVEU1JIWFpERVhWQUJEOFdEfDE3ODgzNTczMzI3NDUmdDoxNzg4MzU3MzMzNDIwJmFkYjphZGJsa19ubyIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImNzYS1jdG9rZW4tWkJZRDc4Q1pFWTZCSzFUVjlWOVoiLAogICAgICAgICAgInZhbHVlIjogIjE3ODgzNjA4MzcwMTYiCiAgICAgICAgfQogICAgICBdCiAgICB9LAogICAgewogICAgICAib3JpZ2luIjogImh0dHBzOi8vd3d3LmFtYXpvbi5jb20iLAogICAgICAibG9jYWxTdG9yYWdlIjogWwogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImNzYS10YWJiZWQtYnJvd3NpbmciLAogICAgICAgICAgInZhbHVlIjogIntcImxhc3RBY3RpdmVcIjp7XCJ2aXNpYmxlXCI6ZmFsc2UsXCJwaWRcIjpcIjRrZ3ZweC1pMHFoZjAtcnBtZTh0LXRodGtnN1wiLFwidGlkXCI6XCI3MGw1amYtMmw3N2NxLXB2MHUxby1tMnRpdmxcIixcImVudFwiOntcInJpZFwiOlwiWjUwUDgwQllUTUJBMDBFUVdHTlFcIixcImV0eVwiOlwiQXV0aGVudGljYXRpb25Qb3J0YWxcIixcImVzdHlcIjpcIlNpZ25JblB3ZENvbGxlY3RcIn19LFwibGFzdEludGVyYWN0aW9uXCI6e1wiaWRcIjpcImNlaDQ5OC1vNm5tN3ctYXF3MHgyLW1kazY0NFwiLFwidXNlZFwiOmZhbHNlfSxcInRpbWVcIjoxNzg4MzU3MjEwNDAwLFwiaW5pdGlhbGl6ZWRcIjp0cnVlfSIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImNzbS1iZiIsCiAgICAgICAgICAidmFsdWUiOiAiW1wiWjUwUDgwQllUTUJBMDBFUVdHTlFcIixcIlY5RTBHVjJGOTNHWTRFQzYwNUpBXCJdIgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm5hbWUiOiAiYS1mb250LWNsYXNzIiwKICAgICAgICAgICJ2YWx1ZSI6ICJhLWVtYmVyIGEtZW1iZXItMS0wLTAgYS1lbWJlci1tb2Rlcm4tZGlzcGxheSBhLWVtYmVyLW1vZGVybi1kaXNwbGF5LTEtMC0wIGEtZW1iZXItbW9kZXJuLXRleHQgYS1lbWJlci1tb2Rlcm4tdGV4dC0xLTAtMCIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImFtem5mYmdpZCIsCiAgICAgICAgICAidmFsdWUiOiAiWDk1LTA3MzA3MjYtNDYxNjc3NDoxNzg4MzU3MTY3IgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm5hbWUiOiAiY3NhLWN0b2tlbi1aNTBQODBCWVRNQkEwMEVRV0dOUSIsCiAgICAgICAgICAidmFsdWUiOiAiMTc4ODM2MDgxMDM5NiIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICJuYW1lIjogImNzbS1oaXQiLAogICAgICAgICAgInZhbHVlIjogInRiOlY5RTBHVjJGOTNHWTRFQzYwNUpBK3MtWjUwUDgwQllUTUJBMDBFUVdHTlF8MTc4ODM1NzIxMjUxNSZ0OjE3ODgzNTcyMTI1MTUmYWRiOmFkYmxrX25vIgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm5hbWUiOiAiY3NtOmFkYiIsCiAgICAgICAgICAidmFsdWUiOiAiYWRibGtfbm8iCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibmFtZSI6ICJjc2EtY3Rva2VuLVY5RTBHVjJGOTNHWTRFQzYwNUpBIiwKICAgICAgICAgICJ2YWx1ZSI6ICIxNzg4MzYwNzYzNTE2IgogICAgICAgIH0KICAgICAgXQogICAgfQogIF0KfQ==`;

const IMDB_PRO_ORIGIN = 'https://pro.imdb.com';
const NAVIGATION_TIMEOUT = 120_000;
const PROFILE_TIMEOUT = 120_000;
const DIRECT_CONTACT_WAIT = 2_000;
let diagnosticCaptured = false;

// Any of these words showing up in a card means we have wandered into a
// different category, not the person's own Direct Contact card. If a copied
// block contains any of these, we refuse to save it, no exceptions.
const OTHER_CATEGORY_KEYWORDS = [
    'company:',
    'guild',
    'union',
    'association',
    'talent agent',
    'manager',
    'publicist',
    'legal rep',
    'representative',
    'branch',
    'client',
    'employer',
    'agency',
];

function randomJitterMs(baseMs: number, spreadMs: number): number {
    return baseMs + Math.floor(Math.random() * spreadMs);
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function normalizeText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeStartUrl(value: string): string {
    return value.trim().replace(/&amp;/gi, '&');
}

function extractImdbId(href: string): string | null {
    const match = href.match(/\/name\/(nm\d+)/i);
    return match ? match[1].toLowerCase() : null;
}

function extractEmail(value: string): string | null {
    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0].trim() : null;
}

function containsOtherCategory(text: string): boolean {
    const lower = text.toLowerCase();
    return OTHER_CATEGORY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function resolveAuthState(inputAuthState: unknown): unknown {
    if (
        inputAuthState !== undefined &&
        inputAuthState !== null &&
        inputAuthState !== ''
    ) {
        return parseAuthState(inputAuthState);
    }

    const embedded = EMBEDDED_AUTH_STATE_B64.trim();

    if (!embedded || embedded === 'PASTE_YOUR_AUTH_STATE_JSON_HERE') {
        throw new Error(
            'No authState was supplied in the input, and no session has been ' +
                'embedded in the source yet. Either fill in the authState input ' +
                'field for this run, or paste a real session into ' +
                'EMBEDDED_AUTH_STATE_B64 in main.ts.',
        );
    }

    const decoded = Buffer.from(embedded, 'base64').toString('utf-8');
    return parseAuthState(decoded);
}

function parseAuthState(value: unknown): unknown {
    if (typeof value !== 'string') return value;

    const trimmed = value.trim();

    if (!trimmed) {
        throw new Error('authState is empty.');
    }

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        throw new Error(`Could not parse authState JSON: ${errorMessage(error)}`);
    }
}

async function isVisible(locator: Locator): Promise<boolean> {
    return locator.isVisible().catch(() => false);
}

async function findVisibleLocator(
    page: Page,
    selectors: string[],
): Promise<Locator | null> {
    for (const selector of selectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);

        for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i);
            if (await isVisible(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

async function verifyAuthentication(page: Page, startUrl: string): Promise<void> {
    console.log('Checking IMDbPro authentication...');

    await page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT,
    });

    await page.waitForTimeout(3_000);

    const finalUrl = page.url();
    const title = await page.title().catch(() => '');

    console.log(`AUTH URL: ${finalUrl}`);
    console.log(`AUTH TITLE: ${title}`);

    const lowerUrl = finalUrl.toLowerCase();
    const lowerTitle = title.toLowerCase();

    const looksLikeLogin =
        lowerUrl.includes('/signin') ||
        lowerUrl.includes('/login') ||
        lowerUrl.includes('/ap/signin') ||
        lowerTitle.includes('sign in') ||
        lowerTitle.includes('log in');

    if (looksLikeLogin) {
        throw new Error(
            'IMDbPro authentication failed. The session being used appears to ' +
                'be unauthenticated or expired.',
        );
    }

    if (!lowerUrl.includes('pro.imdb.com')) {
        throw new Error(
            `IMDbPro authentication check reached an unexpected URL: ${finalUrl}`,
        );
    }

    console.log('IMDbPro authentication check passed.');
}

async function discoverPeople(
    page: Page,
    pageNumber: number,
    baseUrl: string,
): Promise<Person[]> {
    const url = new URL(baseUrl);
    url.searchParams.set('pageNumber', String(pageNumber));

    console.log('\n==============================');
    console.log(`OPENING DISCOVERY PAGE ${pageNumber}`);
    console.log('==============================');

    let loaded = false;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await page.goto(url.toString(), {
                waitUntil: 'domcontentloaded',
                timeout: NAVIGATION_TIMEOUT,
            });

            console.log('Waiting for IMDbPro results...');
            await page.waitForTimeout(5_000);

            loaded = true;
            break;
        } catch (error) {
            console.error(
                `Discovery page ${pageNumber}, attempt ${attempt} failed: ${errorMessage(error)}`,
            );

            if (attempt < 2) {
                await page.waitForTimeout(2_000);
            }
        }
    }

    if (!loaded) {
        throw new Error(`Could not load discovery page ${pageNumber}.`);
    }

    console.log(`FINAL URL: ${page.url()}`);
    console.log(`TITLE: ${await page.title().catch(() => '')}`);

    const links = page.locator('a[href*="/name/nm"]');
    const count = await links.count();

    console.log(`NAME LINKS FOUND ON PAGE ${pageNumber}: ${count}`);

    const people: Person[] = [];
    const pageIds = new Set<string>();

    for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const href = await link.getAttribute('href').catch(() => null);

        if (!href) continue;

        const imdbId = extractImdbId(href);

        if (!imdbId || pageIds.has(imdbId)) continue;

        pageIds.add(imdbId);

        const profileUrl = new URL(href, page.url()).toString();
        const name = normalizeText(await link.innerText().catch(() => '')) || imdbId;

        people.push({ imdbId, name, profileUrl, discoveryPage: pageNumber });
    }

    console.log(`UNIQUE PEOPLE FOUND ON PAGE ${pageNumber}: ${people.length}`);

    return people;
}

// IMDbPro renders each contact category (Direct Contact, Company, Guild,
// Talent Agent, and so on) as its own accordion item, and gives that
// specific item's own container an id containing the category name itself,
// for example accordion-item-direct-contact-item. This is a hard, stable
// hook to the exact right section, no guessing from nearby text needed.
async function findDirectContactContainer(page: Page): Promise<Locator | null> {
    const candidate = page.locator('[id*="direct-contact" i]').first();

    const alreadyThere = await candidate
        .waitFor({ state: 'attached', timeout: 3_000 })
        .then(() => true)
        .catch(() => false);

    if (!alreadyThere) {
        // The section's own content is only built into the page once its
        // accordion is opened. On a fresh visit it usually starts closed, so
        // find the toggle that controls it by the same id pattern and open
        // it first, then look again.
        const toggle = page.locator('[aria-controls*="direct-contact" i]').first();
        const toggleCount = await toggle.count().catch(() => 0);

        if (toggleCount > 0) {
            await toggle.click({ timeout: 8_000 }).catch(() => undefined);
        }

        try {
            await candidate.waitFor({ state: 'attached', timeout: 8_000 });
        } catch {
            return null;
        }
    }

    if (await isVisible(candidate)) {
        return candidate;
    }

    return null;
}

async function getCopyButtonWithin(container: Locator): Promise<Locator | null> {
    // IMDbPro's own copy button in this section carries a stable internal
    // label, copy-card-button, checked first since it is exact. The broader
    // selectors below only run if that ever changes on their end.
    const selectors = [
        'button[data-testid="copy-card-button"]',
        '[role="button"][data-testid="copy-card-button"]',
        'button[aria-label*="copy" i]',
        '[role="button"][aria-label*="copy" i]',
        'button[title*="copy" i]',
        '[role="button"][title*="copy" i]',
        'button[data-testid*="copy" i]',
        '[role="button"][data-testid*="copy" i]',
        'button:has-text("Copy")',
        '[role="button"]:has-text("Copy")',
    ];

    for (const selector of selectors) {
        const locator = container.locator(selector);
        const count = await locator.count().catch(() => 0);

        for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i);
            if (await isVisible(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}



async function clearClipboard(page: Page): Promise<boolean> {
    try {
        return await page.evaluate(async () => {
            try {
                await navigator.clipboard.writeText('');
                return true;
            } catch {
                return false;
            }
        });
    } catch {
        return false;
    }
}

async function readClipboard(page: Page): Promise<string> {
    try {
        const text = await page.evaluate(async () => {
            try {
                return await navigator.clipboard.readText();
            } catch {
                return '';
            }
        });

        return normalizeText(text);
    } catch {
        return '';
    }
}

async function captureDiagnosticsOnce(page: Page, imdbId: string): Promise<void> {
    if (diagnosticCaptured) return;
    diagnosticCaptured = true;

    try {
        const html = await page.content();
        await Actor.setValue(`diagnostic-html-${imdbId}`, html, { contentType: 'text/html' });

        const screenshot = await page.screenshot({ fullPage: true });
        await Actor.setValue(`diagnostic-screenshot-${imdbId}`, screenshot, { contentType: 'image/png' });

        const hasDirectContactText = html.toLowerCase().includes('direct-contact');
        const hasDirectContactWord = html.toLowerCase().includes('direct contact');
        console.log(
            `DIAGNOSTIC CAPTURED for ${imdbId}: html length=${html.length}, ` +
                `contains "direct-contact"=${hasDirectContactText}, ` +
                `contains "direct contact"=${hasDirectContactWord}`,
        );
    } catch (error) {
        console.log(`DIAGNOSTIC CAPTURE FAILED for ${imdbId}: ${errorMessage(error)}`);
    }
}

async function extractDirectContact(page: Page): Promise<DirectContactResult> {
    try {
        const container = await findDirectContactContainer(page);

        if (!container) {
            console.log('DIRECT CONTACT: section not found on this profile. Nothing will be saved.');
            return { raw: null, status: 'not_found', error: null };
        }

        console.log('DIRECT CONTACT: section found.');

        // The section is usually already expanded on page load, but if it is
        // ever collapsed, its toggle control references it by this id, so
        // try opening it first. A failed attempt here is not fatal.
        const containerId = await container.getAttribute('id').catch(() => null);

        if (containerId) {
            const toggle = page.locator(`[aria-controls="${containerId}"]`);
            const toggleCount = await toggle.count().catch(() => 0);

            if (toggleCount > 0) {
                await toggle.first().click({ timeout: 5_000 }).catch(() => undefined);
                await page.waitForTimeout(DIRECT_CONTACT_WAIT);
            }
        }

        // Clipboard copying through an automated browser is unreliable, it
        // came back empty in testing even after a successful click. Reading
        // the section's own visible text directly is just as accurate and
        // does not depend on that flaky step at all.
        const rawText = normalizeText(await container.innerText().catch(() => ''));
        console.log(`DIRECT CONTACT: section text length = ${rawText.length}`);

        if (!rawText) {
            console.log('DIRECT CONTACT: section had no readable text. Nothing will be saved.');
            return { raw: null, status: 'no_email', error: null };
        }

        if (containsOtherCategory(rawText)) {
            console.log(
                'DIRECT CONTACT: section text still mentions another category ' +
                    '(Company, Guild, Agent, etc). Refusing to save this one.',
            );
            return { raw: rawText, status: 'leaked', error: null };
        }

        const email = extractEmail(rawText);

        if (!email) {
            console.log('DIRECT CONTACT: section text has no valid email. Nothing will be saved.');
            return { raw: rawText, status: 'no_email', error: null };
        }

        console.log(`DIRECT CONTACT EMAIL CONFIRMED: ${email}`);
        return { raw: rawText, status: 'found', error: null };
    } catch (error) {
        const message = errorMessage(error);
        console.error(`DIRECT CONTACT ERROR: ${message}`);
        return { raw: null, status: 'error', error: message };
    }
}

async function processProfile(page: Page, person: Person): Promise<PersonRecord | null> {
    console.log('\n------------------------------');
    console.log(`PROCESSING: ${person.name} (${person.imdbId})`);
    console.log('------------------------------');

    try {
        await page.goto(person.profileUrl, {
            waitUntil: 'domcontentloaded',
            timeout: PROFILE_TIMEOUT,
        });

        // Most of this page's real content, including contacts, loads in
        // through separate background data calls after the page itself
        // finishes loading. Waiting for that background activity to settle
        // is far more reliable than guessing a fixed number of seconds.
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(randomJitterMs(1_200, 1_800));

        console.log(`PROFILE URL: ${page.url()}`);

        const currentUrl = page.url().toLowerCase();

        if (
            currentUrl.includes('/signin') ||
            currentUrl.includes('/login') ||
            currentUrl.includes('/ap/signin')
        ) {
            throw new Error('IMDbPro authentication expired or profile redirected to login.');
        }

        const contact = await extractDirectContact(page);

        if (contact.status !== 'found') {
            if (contact.status === 'not_found') {
                await captureDiagnosticsOnce(page, person.imdbId);
            }
            console.log(`NO DIRECT CONTACT EMAIL: ${person.imdbId}. Nothing pushed to dataset.`);
            return null;
        }

        const record: PersonRecord = {
            discoveryPage: person.discoveryPage,
            directContactRaw: contact.raw ?? '',
        };

        await Actor.pushData(record);

        console.log(`SAVED DIRECT CONTACT for ${person.imdbId}.`);

        return record;
    } catch (error) {
        console.error(`ERROR PROCESSING ${person.imdbId}: ${errorMessage(error)}`);
        return null;
    }
}

await Actor.init();

let browser: Browser | null = null;
let context: BrowserContext | null = null;

try {
    const input = (await Actor.getInput()) as Input | null;

    if (!input) {
        throw new Error('Actor input is missing.');
    }

    if (!input.startUrl || typeof input.startUrl !== 'string') {
        throw new Error('startUrl is required.');
    }

    const startUrl = normalizeStartUrl(input.startUrl);
    const authState = resolveAuthState(input.authState);

    const maxPages = Math.max(0, Number(input.maxPages ?? 0));
    const maxProfiles = Math.max(0, Number(input.maxProfiles ?? 0));

    const startUrlObject = new URL(startUrl);

    const startingPage = Math.max(
        1,
        Number(startUrlObject.searchParams.get('pageNumber') ?? '1') || 1,
    );

    console.log('\n==============================');
    console.log('IMDbPro DIRECT CONTACT SCRAPER');
    console.log('==============================');
    console.log(`Start URL: ${startUrl}`);
    console.log(`Starting page: ${startingPage}`);
    console.log(`Maximum pages: ${maxPages === 0 ? 'UNLIMITED' : maxPages}`);
    console.log(`Maximum profiles: ${maxProfiles === 0 ? 'UNLIMITED' : maxProfiles}`);
    console.log('Only cards with a heading that says exactly "Direct Contact" are ever touched.');
    console.log('Dataset behaviour: SAVE IMMEDIATELY AFTER EACH VALID DIRECT CONTACT');

    // Route everything through Apify's own proxy addresses, included free
    // on every plan, instead of the container's single fixed address. The
    // free pool only has a handful of addresses in it, and one of them
    // occasionally times out entirely, so a fresh address is requested and
    // the whole browser relaunched if that happens, rather than giving up
    // on the very first bad connection.
    async function buildProxyForNewSession(): Promise<
        { server: string; username?: string; password?: string } | undefined
    > {
        try {
            const proxyConfiguration = await Actor.createProxyConfiguration();

            if (!proxyConfiguration) return undefined;

            const sessionId = `imdbpro_${Math.floor(Math.random() * 1_000_000)}`;
            const proxyUrl = await proxyConfiguration.newUrl(sessionId);

            if (!proxyUrl) return undefined;

            const parsed = new URL(proxyUrl);

            return {
                server: `${parsed.protocol}//${parsed.host}`,
                username: decodeURIComponent(parsed.username),
                password: decodeURIComponent(parsed.password),
            };
        } catch (error) {
            console.log(`Could not set up Apify proxy, continuing without it: ${errorMessage(error)}`);
            return undefined;
        }
    }

    async function launchBrowserAndContext(): Promise<{ browser: Browser; context: BrowserContext }> {
        const launchProxy = await buildProxyForNewSession();

        if (launchProxy) {
            console.log('Using a fresh Apify proxy address for this attempt.');
        }

        const newBrowser = await chromium.launch({
            headless: true,
            proxy: launchProxy,
            args: ['--disable-blink-features=AutomationControlled'],
        });

        const newContext = await newBrowser.newContext({
            storageState: authState as any,
            viewport: { width: 1920, height: 1080 },
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        await newContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
            origin: IMDB_PRO_ORIGIN,
        });

        return { browser: newBrowser, context: newContext };
    }

    const MAX_LAUNCH_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
        console.log(`\nLaunch attempt ${attempt} of ${MAX_LAUNCH_ATTEMPTS}...`);

        const launched = await launchBrowserAndContext();
        browser = launched.browser;
        context = launched.context;

        const authPage = await context.newPage();

        try {
            await verifyAuthentication(authPage, startUrl);
            await authPage.close().catch(() => undefined);
            break;
        } catch (error) {
            await authPage.close().catch(() => undefined);

            const isConnectionIssue = errorMessage(error).includes('ERR_TIMED_OUT') ||
                errorMessage(error).includes('ERR_CONNECTION') ||
                errorMessage(error).includes('ERR_PROXY');

            if (isConnectionIssue && attempt < MAX_LAUNCH_ATTEMPTS) {
                console.log(
                    `Connection level failure on this proxy address, trying a fresh one: ${errorMessage(error)}`,
                );
                await launched.context.close().catch(() => undefined);
                await launched.browser.close().catch(() => undefined);
                continue;
            }

            throw error;
        }
    }

    if (!context || !browser) {
        throw new Error('Browser context was not established after all launch attempts.');
    }

    const discoveryPage = await context.newPage();
    const profilePage = await context.newPage();

    const seenImdbIds = new Set<string>();

    let totalDiscovered = 0;
    let totalProcessed = 0;
    let totalSaved = 0;
    let pageNumber = startingPage;

    while (maxPages === 0 || pageNumber < startingPage + maxPages) {
        const people = await discoverPeople(discoveryPage, pageNumber, startUrl);

        if (people.length === 0) {
            console.log(`No people found on page ${pageNumber}. Stopping pagination.`);
            break;
        }

        totalDiscovered += people.length;

        for (const person of people) {
            if (seenImdbIds.has(person.imdbId)) continue;

            if (maxProfiles > 0 && totalProcessed >= maxProfiles) {
                console.log(`Reached configured profile limit: ${maxProfiles}`);
                break;
            }

            seenImdbIds.add(person.imdbId);
            totalProcessed++;

            const saved = await processProfile(profilePage, person);

            if (saved) {
                totalSaved++;
            }

            console.log(`PROGRESS: processed=${totalProcessed}, saved=${totalSaved}`);

            // A real person never opens profiles back to back at a perfectly
            // even pace. A small random pause between each one is cheap and
            // avoids the most obvious automated signature: uniform timing.
            await profilePage.waitForTimeout(randomJitterMs(800, 2_200));
        }

        if (maxProfiles > 0 && totalProcessed >= maxProfiles) {
            console.log(`Reached configured profile limit: ${maxProfiles}.`);
            break;
        }

        pageNumber++;
    }

    console.log('\n==============================');
    console.log('SCRAPER FINISHED');
    console.log('==============================');
    console.log(`Pages processed: ${pageNumber - startingPage}`);
    console.log(`People discovered: ${totalDiscovered}`);
    console.log(`Profiles processed: ${totalProcessed}`);
    console.log(`Direct Contact records saved: ${totalSaved}`);
    console.log('Only Direct Contact cards with a confirmed email were written to the dataset.');
} catch (error) {
    console.error(`FATAL ACTOR ERROR: ${errorMessage(error)}`);
    throw error;
} finally {
    if (context) {
        await context.close().catch(() => undefined);
    }

    if (browser) {
        await browser.close().catch(() => undefined);
    }

    await Actor.exit();
}
