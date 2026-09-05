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
const EMBEDDED_AUTH_STATE_JSON = `{
  "cookies": [
    {
      "name": "at-ATVPDKIKX0DER",
      "value": "Atza|gQCx8y3YAwEBAIdalqRfE2mszWsQsSGvDSf5JsfBxAbvkSrWWxi4YfJnHnLM9Q4NiBGOHvQ94UaBRTtb7zINbaVhwxbZZKxF4HZOBdu27JGJ3jZM02pLEvEEVFA3VF19zgNJLdyVLqEeXE0hgdvBrNRNWvEEvtt4dn7pKUTvpMy3qrFkK1z8u0hXuAWJ3BcqtP8vJNfZnXXE4yGE3z3YPYdxEbOFFyR3kC9kONO0cFhBF_L_qArTM8Om8ng-R6ZGLoV6QE5mjzY_Ojjghh_a6fbkPuoXaZz4JhSptfni5iUH2ciKdKyq88ZX647NIZxFyNmbD7vd0_A1R7jpGyexQBrSmdOnGHw31TMl9P5Fd7TOQgSOyGgD1NtvJVQ7UmXJY2mULdBT_0SYKM2iUqHOtPqmeEIS4VYhlB9pQcicCjI",
      "domain": ".www.amazon.com",
      "path": "/ap",
      "expires": -1,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "sess-at-ATVPDKIKX0DER",
      "value": "1EoUJZ9hYXra11R2fpPGhz/X5+EPU+hsdN5IRqArwaU=",
      "domain": ".www.amazon.com",
      "path": "/ap",
      "expires": -1,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "uu",
      "value": "eyJpZCI6InV1YmFmNjNjYjYwYjdmNDk1OGIwZjYiLCJwcmVmZXJlbmNlcyI6eyJmaW5kX2luY2x1ZGVfYWR1bHQiOmZhbHNlfX0=",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1822917009.143364,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "session-id",
      "value": "136-4448739-8242764",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1822917332.561445,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "ubid-main",
      "value": "131-8225945-6688704",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1819893220.127699,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "aws-waf-token",
      "value": "5f7a8fc4-e9d6-470c-bd5e-d9a1a14153a6:EQoAqklgV8CdAAAA:8pDT/g4QVWZUe43k4ky4FI6NBcJOHBOqavSKfi7Dr+GdKjEWRLIqrWfUZQf7LNjUEcytQX3inHJ32tBs6F1Xm1LHS4NzxsKtxTCKC9xhx0E8pW7Z/Y03GyE9W/Ob1FjSbOznobeqq3ZP9OqdlKY83bD4kN2Mcya1Ib620hwpeWVapNTsRTxJoSOCMCrir8H1xs1WhDkA5k5W2MeTWgJ1jP4R+cmGas0jHewTqQceECo+FcW0tTubLZMc6b0gmsTkVjpzlFEgAqT+AM6/GuwVJS4IsyHvXr2Hh6LZ8zIdfuauw9zqgNwTxOeFkdPQBTezcdEccv97i63LIohP",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1788702640,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "session-id",
      "value": "135-2864476-1711917",
      "domain": ".amazon.com",
      "path": "/",
      "expires": 1819893219.465407,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "sst-main",
      "value": "Sst1|PQJyATVoCzY6eJjE7uL_QfwvBw7rJrdcL6v22jzbZfvWizYBtC8BeUPWctaHWXeMFowKKTd_PBCLTVKrUp2_EH-nWc5AKNfivsH2CW4chS9WkftT0qDeT0ibFo4GjIfWckttsLx2tnqRBUbVqgHUUEacG2c_DZu0QIoBV627MY5bbo2-sK2fqbDfCKsYOs_I-uRCAJGmm40qziMZDLIbqA1hyIjgsIoBM5Zdn6Gw3y6Yt1v8M-l6GxdNuTchMfSK6-t4",
      "domain": ".amazon.com",
      "path": "/",
      "expires": 1819893219.467293,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "id_pkel",
      "value": "n0",
      "domain": "www.amazon.com",
      "path": "/",
      "expires": 1788358110,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Strict"
    },
    {
      "name": "id_pk",
      "value": "eyJuIjoiMCIsImNjIjoiMSJ9",
      "domain": "www.amazon.com",
      "path": "/",
      "expires": 1788358117,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Strict"
    },
    {
      "name": "ubid-main",
      "value": "130-3524937-3047745",
      "domain": ".amazon.com",
      "path": "/",
      "expires": 1819893219.466461,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "lc-main",
      "value": "en_US",
      "domain": ".amazon.com",
      "path": "/",
      "expires": 1819893209.848836,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "csm-hit",
      "value": "tb:V9E0GV2F93GY4EC605JA+s-Z50P80BYTMBA00EQWGNQ|1788357212515&t:1788357212515&adb:adblk_no",
      "domain": "www.amazon.com",
      "path": "/",
      "expires": 1818597212,
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax"
    },
    {
      "name": "session-id-time",
      "value": "1819893011l",
      "domain": ".amazon.com",
      "path": "/",
      "expires": 1819893219.46593,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "session-token",
      "value": "7f0W0fUUXJFOLXYCnwWe/UFZY5/fY22ZBjO9nuGPFtHoeSba0bjRO1AdA4GK8CJMfdWU30JB/LCwXPbT1zxenBmRJG9eJNw7kaOaxQMdKAVou4gvFMtNpbuOqzYBDQB6f6iKaf7lTnIiDnKzcsMu3fh+kGFQb4Ag/iZ7LRO7A4Y2R7DpicREzc/YmQHZGeWoM+fX/oBLVF+Ps0TqTbxTfz1RMdoxaQoK",
      "domain": ".amazon.com",
      "path": "/",
      "expires": 1819893219.466993,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "sst-main",
      "value": "Sst1|PQLstN49M0_lIVWtsYWK06ckB43Y49uD0MKT1lMx7O2KHMMVgO2t1eImQy0m8XvyvnlhDwMZ2BBmmr_RoPQ-lRkULf34xl2lCaO5vGezmVmxL3RE9-rJiSAAOsp4P8cOhoXwhERU-AG2OSXNC4rlTJFPlHfNdSQ8G_fF1Rvzv1QLbzBwdZrXMPrsgTc39d2-YPdoDHw2PUkx1HukVXUqGcjRiY7QRjZCa0MaOTwVCEZ9ZLQOn7DiU65HZyzmO-FT23kU",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1819893220.128158,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "x-main",
      "value": "C9iPRBnpvFdJ@sQAOYvvXfzHkn0UbLQC9zE6CUWWiQp5UvcZXhFtPiX4xQIkn8xN",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1819893220.129629,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "at-main",
      "value": "Atza|gQCx8y3YAwEBAIdalqRfE2mszWsQsSGvDSf5JsfBxAbvkSrWWxi4YfJnHnLM9Q4NiBGOHvQ94UaBRTtb7zINbaVhwxbZZKxF4HZOBdu27JGJ3jZM02pLEvEEVFA3VF19zgNJLdyVLqEeXE0hgdvBrNRNWvEEvtt4dn7pKUTvpMy3qrFkK1z8u0hXuAWJ3BcqtP8vJNfZnXXE4yGE3z3YPYdxEbOFFyR3kC9kONO0cFhBF_L_qArTM8Om8ng-R6ZGLoV6QE5mjzY_Ojjghh_a6fbkPuoXaZz4JhSptfni5iUH2ciKdKyq88ZX647NIZxFyNmbD7vd0_A1R7jpGyexQBrSmdOnGHw31TMl9P5Fd7TOQgSOyGgD1NtvJVQ7UmXJY2mULdBT_0SYKM2iUqHOtPqmeEIS4VYhlB9pQcicCjI",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1819893220.129897,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "sess-at-main",
      "value": "1EoUJZ9hYXra11R2fpPGhz/X5+EPU+hsdN5IRqArwaU=",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1819893220.13022,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "session-id-time",
      "value": "2082787201l",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1822917332.562675,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "log-main",
      "value": "906b7188-f15d-46b3-83e3-440b5004ccec",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1788368020.622085,
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "ci",
      "value": "eyJhY3QiOiJDUXB3bmtBUXB3bmtBRjRBQkNFTmg2LWdBQUFBQUFBQUFCYW1HOFFCMkdvc05UNGF0aHJERFh1R3dZYkR3MlREWmVHMFlid0FBRUFBQUFBIiwiZ2N0IjoiQ1Fwd25rQVFwd25rQUY0QUJDRU5DckZnQU5MQUFBQUFBQmFnTDR3V1FBRlFBTUFBMEFDb0FHUUFPQUFnZ0JJQUVvQUp3QVZBQXRBQmxBRFFBTlFBY2dBOUFCLUFFS0FJb0FqUUJNQUU0QUtBQVVnQXFBQmRnRENBTVVBYkFCdWdEa0FPWUFmQUFfQUNBQUVJQUlpQVJ3QkhnQ2FBRmFBTGdBYW9BNkFCNGdEOWdJZ0FpSUJFd0NMUUVjQVIwQWt3QktnQ1dnRXdBSndBVHNBcG9CV1FDdkFHS0FNNkFaOEE0UUJ4QUQtQUltQVJxQWowQlJvQ3BRRnJBTHRBWG1BdmNCZjREQVFHS0FNV0FaWUF6NEJ0b0RnQUhWZ1BNQWZjQV9zQ0FJRUdnSVBnUm5BanNCSG9DVllGTWdMVEFYS0F2aUFBRUFBQXNGQUJnQUNENkFTQURBQUVIMEIwQUdBQUlQb0VvQU1BQVFmUUtRQVlBQWctZ0dBQXdBQkI5QVVBQmdBQ0Q2QXdBREFBRUgwQ0FBR0FBSVBvQ0FBQllBREFBRUgwQUEuSUw0d1dRQUZRQU1BQTBBQ29BR1FBT0FBZ2dCSUFFb0FKd0FWQUF0QUJsQURRQU5RQWNnQTlBQi1BRUtBSW9BalFCTUFFNEFLQUFVZ0FxQUJkZ0RDQU1VQWJBQnVnRGtBT1lBZkFBX0FDQUFFSUFJaUFSd0JIZ0NhQUZhQUxnQWFvQTZBQjRnRDlnSWdBaUlCRXdDTFFFY0FSMEFrd0JLZ0NXZ0V3QUp3QVRzQXBvQldRQ3ZBR0tBTTZBWjhBNFFCeEFELUFJbUFScUFqMEJSb0NwUUZyQUx0QVhtQXZjQmY0REFRR0tBTVdBWllBejRCdG9EZ0FIVmdQTUFmY0Ffc0NBSUVHZ0lQZ1JuQWpzQkhvQ1ZZRk1nTFRBWEtBdmlBLmNBQUFBQUFBQUFBIiwicHVycG9zZXMiOlsiMSIsIjIiLCI0IiwiNyIsIjkiLCIxMCIsIjExIl0sInZlbmRvcnMiOlsiNjgiLCI3NyIsIjc1NSIsIjc5MyIsIjgwNCIsIjExMjYiLCI1MDAyNSIsIjUwMDI5IiwiNTAwMzAiLCI1MDAzOCJdLCJhZ2VTaWduYWwiOiJBRFVMVCIsImlzR2RwciI6dHJ1ZX0",
      "domain": ".imdb.com",
      "path": "/",
      "expires": -1,
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax"
    },
    {
      "name": "_gcl_au",
      "value": "1.1.700198544.1788357229",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1796133228,
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax"
    },
    {
      "name": "session-token",
      "value": "OosyJkR5uHB72vaWnds0D8nRQ2Ywaii+SHz5zSGNyV8Hsfg7616dFAbr6vOjs6isImb11eVv9xgsbMBdeAJf/9/4ZIZ8VaGrnv1ECxL7k7NWT22aex7KP65uuSZMcm4IwuRXC+EBVq8ZI+aHXz0MA9S1e4HBwHFBUVG9oKJIcdOFNqf2tMxcFPVQKYz6664emYiHCsgBgh5FqLag6UIyDBzFhMGPsmDNSTRpu+ia/1CF6MSRE6tb5akbEEWMS6RT",
      "domain": ".imdb.com",
      "path": "/",
      "expires": 1822917332.563275,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "csm-hit",
      "value": "tb:s-SMT5DSRHXZDEXVABD8WD|1788357332745&t:1788357333420&adb:adblk_no",
      "domain": "pro.imdb.com",
      "path": "/",
      "expires": 1818597333,
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax"
    }
  ],
  "origins": [
    {
      "origin": "https://pro.imdb.com",
      "localStorage": [
        {
          "name": "aws_waf_token_challenge_attempts",
          "value": "{\"attempts\":1,\"lastAttemptTimestamp\":1788357008733}"
        },
        {
          "name": "csa-ctoken-2HV0E0DS4WNAKC6EM5YY",
          "value": "1788360644321"
        },
        {
          "name": "csm-bf",
          "value": "[\"SMT5DSRHXZDEXVABD8WD\",\"BQDFEM24NVJ30M9FWQZA\",\"ZBYD78CZEY6BK1TV9V9Z\",\"JB76D79SHB1EVSQPFCJJ\",\"CV8GDHKQ3TNX9DZCEY4Y\",\"2HV0E0DS4WNAKC6EM5YY\"]"
        },
        {
          "name": "a-font-class",
          "value": "a-ember a-ember-1-0-0 a-ember-modern-display a-ember-modern-display-1-0-0 a-ember-modern-text a-ember-modern-text-1-0-0"
        },
        {
          "name": "csa-ctoken-SMT5DSRHXZDEXVABD8WD",
          "value": "1788360933453"
        },
        {
          "name": "csm:adb",
          "value": "adblk_no"
        },
        {
          "name": "awswaf_captcha_solve_timestamp",
          "value": "1788357040883"
        },
        {
          "name": "awswaf_session_storage",
          "value": "5f7a8fc4-e9d6-470c-bd5e-d9a1a14153a6:EQoAqklgVyOVAAAA:P0ILTSDwWO6St9w5Gh6oilVnMbJiY1lDuM64uNqjbxuJxJGLc3RpJca6gVPczerWvgXSSKrT7vIvsa6qceB2gYw5M8I5NC+iQPWTb3O+n1EheNZ7GpK3RkBLvBZ2AWbEE8RIhDvNhZRsmBFMKPmk4XorPWoYpIkwVhGCnJy929vsGFhqxHFlZXjTW4Lq/3S9HZfNRSprLk/UZTEPkDoYLQWcTIYS4iTbLowh/IvLey63Xvk3Iki4MV4Rq99AuOyLzSnHdhRe3HMvF1gEXmP9rcqQtnT3DcRl+uxJxTchth0liUi3oxVVL2kgzBo28cBFXX2bNTVULtfDunqXdwpKkdGR/kSlWrVHOBseHchJB/AJppr1dN2SCTs4QRD46vwtRyS2oSh5ZQ9XuJEMXyvhu31pqFOQrzqGcceZGmuagkW5S6FxmNHeaqqQmiSv6UFc7mU1NLqOBqnl79DOVyFLlsrQCThdVTuuuF1z2U4+SduXUUsPE/bqTVEcpZWbyliNIJwNls5GyQQGmqSh9PsRBkDP/CZqLx3yNZu/uAydLPaP6TJ8eXWMWzUj3kj1txoJIvmhVdoKAnB0UTjDToPMGJJs5w=="
        },
        {
          "name": "_gcl_ls",
          "value": "{\"schema\":\"gcl\",\"version\":1,\"gsid_dc\":{\"value\":{\"joinId\":\"BtApzARScC5UoLR0qXTsq_K3Ttx3Rq1o2Q\",\"lastJoinedTimeMs\":1788357228818},\"expires\":1788357528818},\"gcl_ctr\":{\"value\":{\"value\":0,\"timeouts\":0,\"errors\":0,\"eopCount\":0,\"creationTimeMs\":1788357228825},\"expires\":1796133228825},\"last_convs\":{\"value\":[],\"expires\":1796133228825}}"
        },
        {
          "name": "csa-tabbed-browsing",
          "value": "{\"lastActive\":{\"visible\":true,\"pid\":\"zhkey0-9w0mz7-4hit6i-yli4ip\",\"tid\":\"tpw330-vxt5ph-nr5o1e-qq7deg\",\"ent\":{\"rid\":\"SMT5DSRHXZDEXVABD8WD\",\"ety\":\"name\",\"esty\":\"contacts\"}},\"lastInteraction\":{\"id\":\"w5lggm-rc3vwa-8b0761-9sraa6\",\"used\":true},\"time\":1788357333459,\"initialized\":true}"
        },
        {
          "name": "csa-ctoken-BQDFEM24NVJ30M9FWQZA",
          "value": "1788360899917"
        },
        {
          "name": "csa-ctoken-JB76D79SHB1EVSQPFCJJ",
          "value": "1788360824538"
        },
        {
          "name": "csa-ctoken-CV8GDHKQ3TNX9DZCEY4Y",
          "value": "1788360755715"
        },
        {
          "name": "awswaf_token_refresh_timestamp",
          "value": "1788357010893"
        },
        {
          "name": "csm-hit",
          "value": "tb:s-SMT5DSRHXZDEXVABD8WD|1788357332745&t:1788357333420&adb:adblk_no"
        },
        {
          "name": "csa-ctoken-ZBYD78CZEY6BK1TV9V9Z",
          "value": "1788360837016"
        }
      ]
    },
    {
      "origin": "https://www.amazon.com",
      "localStorage": [
        {
          "name": "csa-tabbed-browsing",
          "value": "{\"lastActive\":{\"visible\":false,\"pid\":\"4kgvpx-i0qhf0-rpme8t-thtkg7\",\"tid\":\"70l5jf-2l77cq-pv0u1o-m2tivl\",\"ent\":{\"rid\":\"Z50P80BYTMBA00EQWGNQ\",\"ety\":\"AuthenticationPortal\",\"esty\":\"SignInPwdCollect\"}},\"lastInteraction\":{\"id\":\"ceh498-o6nm7w-aqw0x2-mdk644\",\"used\":false},\"time\":1788357210400,\"initialized\":true}"
        },
        {
          "name": "csm-bf",
          "value": "[\"Z50P80BYTMBA00EQWGNQ\",\"V9E0GV2F93GY4EC605JA\"]"
        },
        {
          "name": "a-font-class",
          "value": "a-ember a-ember-1-0-0 a-ember-modern-display a-ember-modern-display-1-0-0 a-ember-modern-text a-ember-modern-text-1-0-0"
        },
        {
          "name": "amznfbgid",
          "value": "X95-0730726-4616774:1788357167"
        },
        {
          "name": "csa-ctoken-Z50P80BYTMBA00EQWGNQ",
          "value": "1788360810396"
        },
        {
          "name": "csm-hit",
          "value": "tb:V9E0GV2F93GY4EC605JA+s-Z50P80BYTMBA00EQWGNQ|1788357212515&t:1788357212515&adb:adblk_no"
        },
        {
          "name": "csm:adb",
          "value": "adblk_no"
        },
        {
          "name": "csa-ctoken-V9E0GV2F93GY4EC605JA",
          "value": "1788360763516"
        }
      ]
    }
  ]
}`;

const IMDB_PRO_ORIGIN = 'https://pro.imdb.com';
const NAVIGATION_TIMEOUT = 120_000;
const PROFILE_TIMEOUT = 120_000;
const DIRECT_CONTACT_WAIT = 2_000;

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

    const embedded = EMBEDDED_AUTH_STATE_JSON.trim();

    if (!embedded || embedded === 'PASTE_YOUR_AUTH_STATE_JSON_HERE') {
        throw new Error(
            'No authState was supplied in the input, and no session has been ' +
                'embedded in the source yet. Either fill in the authState input ' +
                'field for this run, or paste a real session into ' +
                'EMBEDDED_AUTH_STATE_JSON in main.ts.',
        );
    }

    return parseAuthState(embedded);
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

// Finds the exact heading node whose own text is just "Direct Contact",
// nothing more. We deliberately reject anything whose text is long, since a
// heading like this should only ever be a couple of words.
async function findDirectContactHeading(page: Page): Promise<Locator | null> {
    const candidateTags = ['div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'p', 'strong', 'b', 'dt', 'li'];

    for (const tag of candidateTags) {
        const locator = page.locator(tag);
        const count = await locator.count().catch(() => 0);

        for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i);

            if (!(await isVisible(candidate))) continue;

            const text = normalizeText(await candidate.innerText().catch(() => ''));

            if (text.length > 40) continue;
            if (!/^direct\s*contact$/i.test(text)) continue;

            return candidate;
        }
    }

    return null;
}

async function getCopyButtonWithin(container: Locator): Promise<Locator | null> {
    const selectors = [
        'button[aria-label*="copy" i]',
        '[role="button"][aria-label*="copy" i]',
        'button[title*="copy" i]',
        '[role="button"][title*="copy" i]',
        'button[data-testid*="copy" i]',
        '[role="button"][data-testid*="copy" i]',
        'button:has-text("Copy")',
        '[role="button"]:has-text("Copy")',
        'button:has(svg[aria-label*="copy" i])',
        'button:has(svg[title*="copy" i])',
        '[role="button"]:has(svg[aria-label*="copy" i])',
        '[role="button"]:has(svg[title*="copy" i])',
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

// Strategy A: the Direct Contact heading and its own card body are expected
// to sit as immediate siblings, one right after the other, with the next
// heading (Company, Guild, whatever comes next) starting a new sibling after
// that. This keeps us from ever touching a neighbouring card.
async function tryFollowingSiblingStrategy(
    heading: Locator,
): Promise<Locator | null> {
    const sibling = heading.locator('xpath=following-sibling::*[1]');
    const count = await sibling.count().catch(() => 0);

    if (count === 0) return null;
    if (!(await isVisible(sibling))) return null;

    const text = normalizeText(await sibling.innerText().catch(() => ''));

    if (containsOtherCategory(text)) return null;

    const copyButton = await getCopyButtonWithin(sibling);

    return copyButton ? sibling : null;
}

// Strategy B: fall back to walking up from the heading, but at every level
// we insist the container's text does NOT contain any other category's
// wording. The first level that has a copy button and stays clean wins. If
// every level that has a copy button is also carrying another category's
// text, we give up rather than guess.
async function tryAncestorWalkStrategy(
    heading: Locator,
): Promise<Locator | null> {
    for (let level = 1; level <= 6; level++) {
        const container = heading.locator(`xpath=ancestor::*[${level}]`);
        const count = await container.count().catch(() => 0);

        if (count === 0) continue;

        const text = normalizeText(await container.innerText().catch(() => ''));

        if (containsOtherCategory(text)) continue;

        const copyButton = await getCopyButtonWithin(container);

        if (copyButton) {
            return container;
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

async function extractDirectContact(page: Page): Promise<DirectContactResult> {
    try {
        const heading = await findDirectContactHeading(page);

        if (!heading) {
            console.log('DIRECT CONTACT: heading not found on this profile. Nothing will be saved.');
            return { raw: null, status: 'not_found', error: null };
        }

        console.log('DIRECT CONTACT: heading found.');

        // Some layouts render the section collapsed, some do not. Try a
        // click, but do not treat a failed click as fatal, since the
        // section may already be open.
        await heading.click({ timeout: 8_000 }).catch(() => undefined);
        await page.waitForTimeout(DIRECT_CONTACT_WAIT);

        let card = await tryFollowingSiblingStrategy(heading);
        let strategyUsed = 'sibling';

        if (!card) {
            card = await tryAncestorWalkStrategy(heading);
            strategyUsed = 'ancestor';
        }

        if (!card) {
            console.log(
                'DIRECT CONTACT: could not isolate a clean container without ' +
                    'other categories mixed in. Skipping rather than risk the ' +
                    'wrong contact.',
            );
            return { raw: null, status: 'no_copy_button', error: null };
        }

        console.log(`DIRECT CONTACT: card isolated using ${strategyUsed} strategy.`);

        const copyButton = await getCopyButtonWithin(card);

        if (!copyButton) {
            console.log('DIRECT CONTACT: card found but no copy button inside it.');
            return { raw: null, status: 'no_copy_button', error: null };
        }

        const clipboardCleared = await clearClipboard(page);

        if (!clipboardCleared) {
            console.log(
                'DIRECT CONTACT: could not clear clipboard. Refusing to trust ' +
                    'possibly stale clipboard data.',
            );
            return { raw: null, status: 'error', error: 'Could not clear clipboard before copying.' };
        }

        console.log('DIRECT CONTACT: clicking copy button...');
        await copyButton.click({ timeout: 15_000 });
        await page.waitForTimeout(750);

        const clipboardText = await readClipboard(page);
        console.log(`DIRECT CONTACT: clipboard length = ${clipboardText.length}`);

        if (!clipboardText) {
            console.log('DIRECT CONTACT: clipboard was empty. Nothing will be saved.');
            return { raw: null, status: 'no_email', error: null };
        }

        if (containsOtherCategory(clipboardText)) {
            console.log(
                'DIRECT CONTACT: copied text still mentions another category ' +
                    '(Company, Guild, Agent, etc). Refusing to save this one.',
            );
            return { raw: clipboardText, status: 'leaked', error: null };
        }

        const email = extractEmail(clipboardText);

        if (!email) {
            console.log('DIRECT CONTACT: copied content has no valid email. Nothing will be saved.');
            return { raw: clipboardText, status: 'no_email', error: null };
        }

        console.log(`DIRECT CONTACT EMAIL CONFIRMED: ${email}`);
        return { raw: clipboardText, status: 'found', error: null };
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

        await page.waitForTimeout(3_000);

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

    browser = await chromium.launch({ headless: true });

    context = await browser.newContext({
        storageState: authState as any,
        viewport: { width: 1920, height: 1080 },
    });

    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: IMDB_PRO_ORIGIN,
    });

    const authPage = await context.newPage();

    try {
        await verifyAuthentication(authPage, startUrl);
    } finally {
        await authPage.close().catch(() => undefined);
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
