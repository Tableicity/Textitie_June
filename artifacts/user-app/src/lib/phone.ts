// US/Canada (NANP) area code -> primary city/state. Trimmed to common entries;
// covers essentially all assigned NANP geographic codes as of 2025. Non-geographic
// codes (toll-free, etc.) and unknown codes return null.
const AREA_CODES: Record<string, string> = {
  "201": "Jersey City, NJ", "202": "Washington, DC", "203": "New Haven, CT",
  "204": "Winnipeg, MB", "205": "Birmingham, AL", "206": "Seattle, WA",
  "207": "Portland, ME", "208": "Boise, ID", "209": "Stockton, CA",
  "210": "San Antonio, TX", "212": "New York, NY", "213": "Los Angeles, CA",
  "214": "Dallas, TX", "215": "Philadelphia, PA", "216": "Cleveland, OH",
  "217": "Springfield, IL", "218": "Duluth, MN", "219": "Gary, IN",
  "220": "Newark, OH", "223": "Lancaster, PA", "224": "Evanston, IL",
  "225": "Baton Rouge, LA", "226": "London, ON", "227": "Silver Spring, MD",
  "228": "Biloxi, MS", "229": "Albany, GA", "231": "Muskegon, MI",
  "234": "Akron, OH", "236": "Vancouver, BC", "239": "Cape Coral, FL",
  "240": "Frederick, MD", "248": "Troy, MI", "249": "Sudbury, ON",
  "250": "Victoria, BC", "251": "Mobile, AL", "252": "Greenville, NC",
  "253": "Tacoma, WA", "254": "Waco, TX", "256": "Huntsville, AL",
  "260": "Fort Wayne, IN", "262": "Kenosha, WI", "263": "Montreal, QC",
  "267": "Philadelphia, PA", "268": "Antigua and Barbuda", "269": "Kalamazoo, MI",
  "270": "Bowling Green, KY", "272": "Scranton, PA", "276": "Bristol, VA",
  "279": "Sacramento, CA", "281": "Houston, TX", "283": "Cincinnati, OH",
  "289": "Hamilton, ON", "301": "Rockville, MD", "302": "Wilmington, DE",
  "303": "Denver, CO", "304": "Charleston, WV", "305": "Miami, FL",
  "306": "Regina, SK", "307": "Cheyenne, WY", "308": "Grand Island, NE",
  "309": "Peoria, IL", "310": "Los Angeles, CA", "312": "Chicago, IL",
  "313": "Detroit, MI", "314": "St. Louis, MO", "315": "Syracuse, NY",
  "316": "Wichita, KS", "317": "Indianapolis, IN", "318": "Shreveport, LA",
  "319": "Cedar Rapids, IA", "320": "St. Cloud, MN", "321": "Orlando, FL",
  "323": "Los Angeles, CA", "325": "Abilene, TX", "326": "Dayton, OH",
  "330": "Akron, OH", "331": "Aurora, IL", "332": "New York, NY",
  "334": "Montgomery, AL", "336": "Greensboro, NC", "337": "Lafayette, LA",
  "339": "Boston, MA", "340": "U.S. Virgin Islands", "341": "Oakland, CA",
  "343": "Ottawa, ON", "346": "Houston, TX", "347": "New York, NY",
  "351": "Lowell, MA", "352": "Gainesville, FL", "353": "Madison, WI",
  "354": "Edmonton, AB", "360": "Vancouver, WA", "361": "Corpus Christi, TX",
  "364": "Bowling Green, KY", "365": "Hamilton, ON", "367": "Quebec City, QC",
  "368": "Calgary, AB", "380": "Columbus, OH", "382": "London, ON",
  "385": "Salt Lake City, UT", "386": "Daytona Beach, FL", "401": "Providence, RI",
  "402": "Omaha, NE", "403": "Calgary, AB", "404": "Atlanta, GA",
  "405": "Oklahoma City, OK", "406": "Billings, MT", "407": "Orlando, FL",
  "408": "San Jose, CA", "409": "Beaumont, TX", "410": "Baltimore, MD",
  "412": "Pittsburgh, PA", "413": "Springfield, MA", "414": "Milwaukee, WI",
  "415": "San Francisco, CA", "416": "Toronto, ON", "417": "Springfield, MO",
  "418": "Quebec City, QC", "419": "Toledo, OH", "423": "Chattanooga, TN",
  "424": "Los Angeles, CA", "425": "Bellevue, WA", "428": "Moncton, NB",
  "430": "Tyler, TX", "431": "Winnipeg, MB", "432": "Midland, TX",
  "434": "Lynchburg, VA", "435": "St. George, UT", "437": "Toronto, ON",
  "438": "Montreal, QC", "440": "Cleveland, OH", "441": "Bermuda",
  "442": "Palm Springs, CA", "443": "Baltimore, MD", "445": "Philadelphia, PA",
  "447": "Springfield, IL", "448": "Tallahassee, FL", "450": "Laval, QC",
  "458": "Eugene, OR", "463": "Indianapolis, IN", "464": "Joliet, IL",
  "469": "Dallas, TX", "470": "Atlanta, GA", "472": "Charlotte, NC",
  "473": "Grenada", "474": "Saskatoon, SK", "475": "New Haven, CT",
  "478": "Macon, GA", "479": "Fort Smith, AR", "480": "Mesa, AZ",
  "484": "Allentown, PA", "501": "Little Rock, AR", "502": "Louisville, KY",
  "503": "Portland, OR", "504": "New Orleans, LA", "505": "Albuquerque, NM",
  "506": "Saint John, NB", "507": "Rochester, MN", "508": "Worcester, MA",
  "509": "Spokane, WA", "510": "Oakland, CA", "512": "Austin, TX",
  "513": "Cincinnati, OH", "514": "Montreal, QC", "515": "Des Moines, IA",
  "516": "Hempstead, NY", "517": "Lansing, MI", "518": "Albany, NY",
  "519": "London, ON", "520": "Tucson, AZ", "530": "Redding, CA",
  "531": "Omaha, NE", "534": "Eau Claire, WI", "539": "Tulsa, OK",
  "540": "Roanoke, VA", "541": "Eugene, OR", "548": "Kitchener, ON",
  "551": "Jersey City, NJ", "557": "St. Louis, MO", "559": "Fresno, CA",
  "561": "West Palm Beach, FL", "562": "Long Beach, CA", "563": "Davenport, IA",
  "564": "Olympia, WA", "567": "Toledo, OH", "570": "Scranton, PA",
  "571": "Arlington, VA", "572": "Oklahoma City, OK", "573": "Columbia, MO",
  "574": "South Bend, IN", "575": "Las Cruces, NM", "579": "Laval, QC",
  "580": "Lawton, OK", "581": "Quebec City, QC", "582": "Erie, PA",
  "584": "Winnipeg, MB", "585": "Rochester, NY", "586": "Warren, MI",
  "587": "Calgary, AB", "601": "Jackson, MS", "602": "Phoenix, AZ",
  "603": "Manchester, NH", "604": "Vancouver, BC", "605": "Sioux Falls, SD",
  "606": "Ashland, KY", "607": "Binghamton, NY", "608": "Madison, WI",
  "609": "Trenton, NJ", "610": "Allentown, PA", "612": "Minneapolis, MN",
  "613": "Ottawa, ON", "614": "Columbus, OH", "615": "Nashville, TN",
  "616": "Grand Rapids, MI", "617": "Boston, MA", "618": "Belleville, IL",
  "619": "San Diego, CA", "620": "Hutchinson, KS", "623": "Glendale, AZ",
  "626": "Pasadena, CA", "627": "Tampa, FL", "628": "San Francisco, CA",
  "629": "Nashville, TN", "630": "Naperville, IL", "631": "Brentwood, NY",
  "636": "O'Fallon, MO", "639": "Saskatoon, SK", "640": "Trenton, NJ",
  "641": "Mason City, IA", "646": "New York, NY", "647": "Toronto, ON",
  "650": "San Mateo, CA", "651": "St. Paul, MN", "656": "Tampa, FL",
  "657": "Anaheim, CA", "658": "Jamaica", "659": "Birmingham, AL",
  "660": "Sedalia, MO", "661": "Bakersfield, CA", "662": "Tupelo, MS",
  "664": "Montserrat", "667": "Baltimore, MD", "669": "San Jose, CA",
  "670": "Northern Mariana Islands", "671": "Guam", "672": "British Columbia",
  "678": "Atlanta, GA", "680": "Syracuse, NY", "681": "Charleston, WV",
  "682": "Fort Worth, TX", "683": "London, ON", "684": "American Samoa",
  "689": "Orlando, FL", "701": "Fargo, ND", "702": "Las Vegas, NV",
  "703": "Arlington, VA", "704": "Charlotte, NC", "705": "Sudbury, ON",
  "706": "Augusta, GA", "707": "Santa Rosa, CA", "708": "Cicero, IL",
  "709": "St. John's, NL", "712": "Sioux City, IA", "713": "Houston, TX",
  "714": "Anaheim, CA", "715": "Eau Claire, WI", "716": "Buffalo, NY",
  "717": "Lancaster, PA", "718": "New York, NY", "719": "Colorado Springs, CO",
  "720": "Denver, CO", "721": "Sint Maarten", "724": "New Castle, PA",
  "725": "Las Vegas, NV", "726": "San Antonio, TX", "727": "St. Petersburg, FL",
  "728": "Cape Coral, FL", "731": "Jackson, TN", "732": "Toms River, NJ",
  "734": "Ann Arbor, MI", "737": "Austin, TX", "740": "Newark, OH",
  "742": "Brampton, ON", "743": "Greensboro, NC", "747": "Los Angeles, CA",
  "753": "Ottawa, ON", "754": "Fort Lauderdale, FL", "757": "Norfolk, VA",
  "758": "Saint Lucia", "760": "Oceanside, CA", "762": "Augusta, GA",
  "763": "Brooklyn Park, MN", "765": "Lafayette, IN", "767": "Dominica",
  "769": "Jackson, MS", "770": "Marietta, GA", "771": "Washington, DC",
  "772": "Port St. Lucie, FL", "773": "Chicago, IL", "774": "Worcester, MA",
  "775": "Reno, NV", "778": "Vancouver, BC", "779": "Rockford, IL",
  "780": "Edmonton, AB", "781": "Lynn, MA", "782": "Halifax, NS",
  "784": "St. Vincent and the Grenadines", "785": "Topeka, KS", "786": "Miami, FL",
  "787": "Puerto Rico", "801": "Salt Lake City, UT", "802": "Burlington, VT",
  "803": "Columbia, SC", "804": "Richmond, VA", "805": "Santa Clarita, CA",
  "806": "Lubbock, TX", "807": "Thunder Bay, ON", "808": "Honolulu, HI",
  "809": "Dominican Republic", "810": "Flint, MI", "812": "Evansville, IN",
  "813": "Tampa, FL", "814": "Erie, PA", "815": "Rockford, IL",
  "816": "Kansas City, MO", "817": "Fort Worth, TX", "818": "Burbank, CA",
  "819": "Sherbrooke, QC", "820": "Oxnard, CA", "825": "Calgary, AB",
  "826": "Roanoke, VA", "828": "Asheville, NC", "829": "Dominican Republic",
  "830": "New Braunfels, TX", "831": "Salinas, CA", "832": "Houston, TX",
  "835": "Allentown, PA", "838": "Albany, NY", "839": "Columbia, SC",
  "840": "San Bernardino, CA", "843": "Charleston, SC", "845": "New City, NY",
  "847": "Evanston, IL", "848": "Toms River, NJ", "849": "Dominican Republic",
  "850": "Tallahassee, FL", "854": "Charleston, SC", "856": "Cherry Hill, NJ",
  "857": "Boston, MA", "858": "San Diego, CA", "859": "Lexington, KY",
  "860": "Hartford, CT", "861": "Springfield, IL", "862": "Newark, NJ",
  "863": "Lakeland, FL", "864": "Greenville, SC", "865": "Knoxville, TN",
  "867": "Yukon/NWT/Nunavut", "868": "Trinidad and Tobago", "869": "St. Kitts and Nevis",
  "870": "Jonesboro, AR", "872": "Chicago, IL", "873": "Sherbrooke, QC",
  "876": "Jamaica", "878": "Pittsburgh, PA", "879": "St. John's, NL",
  "901": "Memphis, TN", "902": "Halifax, NS", "903": "Tyler, TX",
  "904": "Jacksonville, FL", "905": "Mississauga, ON", "906": "Marquette, MI",
  "907": "Anchorage, AK", "908": "Elizabeth, NJ", "909": "San Bernardino, CA",
  "910": "Fayetteville, NC", "912": "Savannah, GA", "913": "Overland Park, KS",
  "914": "Yonkers, NY", "915": "El Paso, TX", "916": "Sacramento, CA",
  "917": "New York, NY", "918": "Tulsa, OK", "919": "Raleigh, NC",
  "920": "Green Bay, WI", "925": "Concord, CA", "928": "Yuma, AZ",
  "929": "New York, NY", "930": "Evansville, IN", "931": "Clarksville, TN",
  "934": "Brentwood, NY", "936": "Conroe, TX", "937": "Dayton, OH",
  "938": "Huntsville, AL", "939": "Puerto Rico", "940": "Denton, TX",
  "941": "Sarasota, FL", "942": "Toronto, ON", "943": "Atlanta, GA",
  "945": "Dallas, TX", "947": "Troy, MI", "948": "Trenton, NJ",
  "949": "Irvine, CA", "951": "Riverside, CA", "952": "Bloomington, MN",
  "954": "Fort Lauderdale, FL", "956": "Laredo, TX", "957": "Albuquerque, NM",
  "959": "Hartford, CT", "970": "Fort Collins, CO", "971": "Portland, OR",
  "972": "Dallas, TX", "973": "Newark, NJ", "975": "Kansas City, MO",
  "978": "Lowell, MA", "979": "College Station, TX", "980": "Charlotte, NC",
  "984": "Raleigh, NC", "985": "Houma, LA", "986": "Boise, ID",
  "989": "Saginaw, MI",
};

/** Strip everything except digits. */
function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Format a phone number as (###)###-#### when it's a 10-digit US/Canada number
 * (with or without leading +1). Falls back to the original input otherwise.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = digits(raw);
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)})${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return raw;
}

/**
 * Best-effort city/state lookup from a phone number's area code (NANP).
 * Returns null for non-NANP numbers or unknown codes.
 */
export function cityStateForPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = digits(raw);
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return AREA_CODES[ten.slice(0, 3)] ?? null;
}
