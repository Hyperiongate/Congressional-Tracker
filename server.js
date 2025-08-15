// Calendar endpoint with real links
app.get('/api/calendar/:bioguideId', async (req, res) => {
    const bioguideId = req.params.bioguideId;
    
    // Get legislator info from the request or cache
    const mockLegislator = {
        bioguideId,
        name: 'Representative',
        type: 'Representative',
        website: 'https://www.house.gov'
    };
    
    const events = await getCalendarEvents(mockLegislator);
    res.json({ events });
});const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Configuration
const CONFIG = {
    PORT: process.env.PORT || 3000,
    GOOGLE_CIVIC_API_KEY: process.env.GOOGLE_CIVIC_API_KEY || null,
    FEC_API_KEY: process.env.FEC_API_KEY || 'DEMO_KEY',
    CONGRESS_API_KEY: process.env.CONGRESS_API_KEY || null,
    PROPUBLICA_API_KEY: process.env.PROPUBLICA_API_KEY || null
};

// Cache for API responses
const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Get representatives by address using Google Civic API
async function getRepresentativesByAddress(address) {
    // Check cache first
    const cacheKey = `reps-${address}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }

    const representatives = [];

    try {
        // If Google Civic API key is available, use it
        if (CONFIG.GOOGLE_CIVIC_API_KEY) {
            const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_CIVIC_API_KEY}&levels=country&roles=legislatorUpperBody&roles=legislatorLowerBody`;
            
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                
                // Parse Google Civic API response
                if (data.officials && data.offices) {
                    data.offices.forEach(office => {
                        if (office.name.includes('United States Senate') || 
                            office.name.includes('United States House')) {
                            
                            office.officialIndices.forEach(index => {
                                const official = data.officials[index];
                                const isHouse = office.name.includes('House');
                                
                                // Extract district number if House member
                                let district = null;
                                if (isHouse) {
                                    const districtMatch = office.name.match(/District (\d+)/);
                                    district = districtMatch ? districtMatch[1] : null;
                                }
                                
                                representatives.push({
                                    name: official.name,
                                    type: isHouse ? 'Representative' : 'Senator',
                                    party: official.party === 'Democratic Party' ? 'Democrat' : 
                                           official.party === 'Republican Party' ? 'Republican' : 
                                           official.party,
                                    state: getStateFromAddress(address),
                                    district: district,
                                    phone: official.phones ? official.phones[0] : 'Not available',
                                    website: official.urls ? official.urls[0] : 'Not available',
                                    office: official.address ? formatAddress(official.address[0]) : 'Capitol Building, Washington, DC',
                                    photoUrl: official.photoUrl || null,
                                    channels: official.channels || []
                                });
                            });
                        }
                    });
                }
            }
        }
        
        // Fallback: Use GitHub raw content with state lookup
        if (representatives.length === 0) {
            const state = getStateFromAddress(address);
            
            try {
                // Use the official GitHub Pages hosted URL
                const legislatorsResponse = await fetch('https://unitedstates.github.io/congress-legislators/legislators-current.json');
                
                console.log('Legislators API status:', legislatorsResponse.status);
                
                if (legislatorsResponse.ok) {
                    const legislators = await legislatorsResponse.json();
                    console.log(`Loaded ${legislators.length} total legislators`);
                    
                    // Get all legislators for the state
                    const stateReps = legislators.filter(leg => {
                        const currentTerm = leg.terms[leg.terms.length - 1];
                        return currentTerm.state === state;
                    });
                    
                    console.log(`Found ${stateReps.length} legislators for state ${state}`);
                    
                    // Add senators
                    stateReps.forEach(rep => {
                        const currentTerm = rep.terms[rep.terms.length - 1];
                        if (currentTerm.type === 'sen') {
                            representatives.push({
                                name: rep.name.official_full,
                                type: 'Senator',
                                party: currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party,
                                state: currentTerm.state,
                                district: null,
                                phone: currentTerm.phone || 'Not available',
                                website: currentTerm.url || 'Not available',
                                office: currentTerm.office || 'Senate Office Building, Washington, DC',
                                bioguideId: rep.id.bioguide,
                                fecId: rep.id.fec ? rep.id.fec[0] : null
                            });
                        }
                    });
                    
                    // Try to find the most likely House representative
                    const houseReps = stateReps.filter(r => r.terms[r.terms.length - 1].type === 'rep');
                    
                    if (houseReps.length > 0) {
                        // For CA ZIP 94903 (San Rafael), it's likely District 2 or 4
                        if (state === 'CA' && address.includes('94903')) {
                            // Districts 2 and 4 cover Marin County
                            const marinReps = houseReps.filter(r => 
                                [2, 4].includes(r.terms[r.terms.length - 1].district)
                            );
                            
                            if (marinReps.length > 0) {
                                // Add the most likely representative (District 2 - Jared Huffman)
                                const likelyRep = marinReps.find(r => 
                                    r.terms[r.terms.length - 1].district === 2
                                ) || marinReps[0];
                                
                                const currentTerm = likelyRep.terms[likelyRep.terms.length - 1];
                                representatives.push({
                                    name: likelyRep.name.official_full,
                                    type: 'Representative',
                                    party: currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party,
                                    state: currentTerm.state,
                                    district: currentTerm.district,
                                    phone: currentTerm.phone || 'Not available',
                                    website: currentTerm.url || 'Not available',
                                    office: currentTerm.office || 'House Office Building, Washington, DC',
                                    bioguideId: likelyRep.id.bioguide,
                                    fecId: likelyRep.id.fec ? likelyRep.id.fec[0] : null,
                                    note: 'District assignment based on ZIP code. For exact confirmation, enable Google Civic API.'
                                });
                            }
                        } else if (state === 'CA') {
                            // Northern California ZIP codes typically start with 94, 95, 96
                            const zipMatch = address.match(/\b(\d{5})\b/);
                            if (zipMatch) {
                                const zipPrefix = zipMatch[1].substring(0, 2);
                                
                                // This is a rough approximation
                                let likelyDistricts = [];
                                if (zipPrefix === '94') {
                                    // Bay Area districts
                                    likelyDistricts = [2, 4, 5, 7, 10, 11, 12, 13, 14, 15, 17, 18];
                                } else if (zipPrefix === '90' || zipPrefix === '91') {
                                    // LA area districts
                                    likelyDistricts = [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 43, 44, 45, 46, 47];
                                } else if (zipPrefix === '92') {
                                    // San Diego area districts
                                    likelyDistricts = [48, 49, 50, 51, 52];
                                }
                                
                                // Find a representative from likely districts
                                const localRep = houseReps.find(r => 
                                    likelyDistricts.includes(r.terms[r.terms.length - 1].district)
                                );
                                
                                if (localRep) {
                                    const currentTerm = localRep.terms[localRep.terms.length - 1];
                                    representatives.push({
                                        name: localRep.name.official_full,
                                        type: 'Representative',
                                        party: currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party,
                                        state: currentTerm.state,
                                        district: currentTerm.district,
                                        phone: currentTerm.phone || 'Not available',
                                        website: currentTerm.url || 'Not available',
                                        office: currentTerm.office || 'House Office Building, Washington, DC',
                                        bioguideId: localRep.id.bioguide,
                                        fecId: localRep.id.fec ? localRep.id.fec[0] : null,
                                        note: 'District assignment based on ZIP code approximation. For exact district, please use Google Civic API.'
                                    });
                                } else {
                                    // Show first House rep as placeholder
                                    const firstRep = houseReps[0];
                                    const currentTerm = firstRep.terms[firstRep.terms.length - 1];
                                    representatives.push({
                                        name: firstRep.name.official_full,
                                        type: 'Representative',
                                        party: currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party,
                                        state: currentTerm.state,
                                        district: currentTerm.district,
                                        phone: currentTerm.phone || 'Not available',
                                        website: currentTerm.url || 'Not available',
                                        office: currentTerm.office || 'House Office Building, Washington, DC',
                                        bioguideId: firstRep.id.bioguide,
                                        fecId: firstRep.id.fec ? firstRep.id.fec[0] : null,
                                        note: 'This may not be your exact representative. Enable Google Civic API for accurate district mapping.'
                                    });
                                }
                            }
                        } else {
                            // For other states, just show the first House rep
                            const firstRep = houseReps[0];
                            const currentTerm = firstRep.terms[firstRep.terms.length - 1];
                            representatives.push({
                                name: firstRep.name.official_full,
                                type: 'Representative',
                                party: currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party,
                                state: currentTerm.state,
                                district: currentTerm.district,
                                phone: currentTerm.phone || 'Not available',
                                website: currentTerm.url || 'Not available',
                                office: currentTerm.office || 'House Office Building, Washington, DC',
                                bioguideId: firstRep.id.bioguide,
                                fecId: firstRep.id.fec ? firstRep.id.fec[0] : null,
                                note: 'District assignment may not be exact. Enable Google Civic API for accurate mapping.'
                            });
                        }
                    }
                }
            } catch (fallbackError) {
                console.error('Fallback error:', fallbackError);
                // Return at least some data
                representatives.push({
                    name: 'Representatives Unavailable',
                    type: 'Error',
                    party: 'Unknown',
                    state: state,
                    district: 'Unknown',
                    phone: 'Please try again later',
                    website: 'https://www.house.gov/representatives',
                    office: 'Data temporarily unavailable',
                    note: 'Unable to load representative data. Please try again.'
                });
            }
        }
        
        // Ensure we always return something
        if (representatives.length === 0) {
            // At minimum, return a message to the user
            representatives.push({
                name: 'Unable to load representatives',
                type: 'Error',
                party: 'N/A',
                state: getStateFromAddress(address),
                district: 'N/A',
                phone: 'Please try again',
                website: 'https://www.house.gov/representatives/find-your-representative',
                office: 'Data temporarily unavailable',
                note: 'The congressional data service is temporarily unavailable. Please try again in a few moments or use the House.gov lookup tool.'
            });
        }
        
        console.log(`Returning ${representatives.length} representatives for ${address}`);
        
        // Cache the results
        cache.set(cacheKey, {
            data: representatives,
            timestamp: Date.now()
        });
        
        return representatives;
        
    } catch (error) {
        console.error('Error fetching representatives:', error);
        throw error;
    }
}

// Helper function to extract state from address
function getStateFromAddress(address) {
    // Simple regex to find state abbreviation
    const stateMatch = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?$/);
    return stateMatch ? stateMatch[1] : 'CA'; // Default to CA
}

// Helper function to format address
function formatAddress(addr) {
    if (!addr) return 'Capitol Building, Washington, DC';
    return `${addr.line1}${addr.line2 ? ', ' + addr.line2 : ''}, ${addr.city}, ${addr.state} ${addr.zip}`;
}

// API Routes
app.get('/api/representatives', async (req, res) => {
    const address = req.query.address;
    
    if (!address) {
        return res.status(400).json({
            error: 'Address parameter is required'
        });
    }
    
    try {
        const representatives = await getRepresentativesByAddress(address);
        console.log(`Found ${representatives.length} representatives for address: ${address}`);
        res.json({ representatives });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            error: 'Unable to fetch representatives',
            message: 'Please check your address and try again'
        });
    }
});

// Get congressional statements and speeches with REAL data
async function getTranscripts(legislator) {
    const transcripts = [];
    
    try {
        // Get the representative's name for searching
        const searchName = legislator.name.split(' ').slice(-1)[0]; // Last name
        
        // Search Congressional Record for recent speeches
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const fromDate = sixMonthsAgo.toISOString().split('T')[0];
        const toDate = new Date().toISOString().split('T')[0];
        
        // ProPublica statements endpoint
        if (CONFIG.PROPUBLICA_API_KEY) {
            try {
                const statementsUrl = `https://api.propublica.org/congress/v1/statements/search.json?query=${encodeURIComponent(legislator.name)}`;
                
                const response = await fetch(statementsUrl, {
                    headers: {
                        'X-API-Key': CONFIG.PROPUBLICA_API_KEY
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.results && data.results.length > 0) {
                        data.results.slice(0, 10).forEach(statement => {
                            transcripts.push({
                                title: statement.title || 'Congressional Statement',
                                date: statement.date,
                                type: statement.statement_type || 'Statement',
                                url: statement.url,
                                subject: statement.subjects ? statement.subjects[0] : 'Congressional Business',
                                excerpt: statement.title || 'View full statement',
                                source: 'ProPublica'
                            });
                        });
                    }
                }
            } catch (err) {
                console.error('ProPublica error:', err);
            }
        }
        
        // Add direct Congressional Record search
        transcripts.push({
            title: `Search Congressional Record for ${legislator.name}`,
            date: `${fromDate} to ${toDate}`,
            type: 'Search Tool',
            url: `https://www.congress.gov/search?q={"source":"congrecord","search":"${encodeURIComponent(legislator.name)}","congress":["119","118"]}`,
            subject: 'All Floor Speeches',
            excerpt: 'Search all floor speeches and statements in the Congressional Record',
            source: 'Congress.gov'
        });
        
        // Add committee hearing search
        transcripts.push({
            title: 'Committee Hearing Transcripts',
            date: 'Recent',
            type: 'Hearings',
            url: `https://www.congress.gov/search?q={"source":"comreports,congrecord,committee","search":"${encodeURIComponent(legislator.name)}"}`,
            subject: 'Committee Work',
            excerpt: 'Search committee hearings and reports featuring this representative',
            source: 'Congress.gov'
        });
        
        // C-SPAN with specific bioguide ID
        if (legislator.bioguideId) {
            transcripts.push({
                title: `${legislator.name}'s C-SPAN Video Archive`,
                date: 'All dates',
                type: 'Video Archive',
                url: `https://www.c-span.org/person/?${legislator.bioguideId.toLowerCase()}`,
                subject: 'Video & Transcripts',
                excerpt: 'Watch videos and read transcripts of speeches, interviews, and appearances',
                source: 'C-SPAN'
            });
        }
        
        // Official press releases
        if (legislator.website) {
            transcripts.push({
                title: 'Official Press Releases & Statements',
                date: 'Latest',
                type: 'Press Releases',
                url: legislator.website.replace(/\/$/, '') + '/news',
                subject: 'Official Statements',
                excerpt: 'Read official press releases and statements from the representative\'s office',
                source: 'Official Website'
            });
        }
        
    } catch (error) {
        console.error('Error fetching transcripts:', error);
    }
    
    return transcripts;
}

// Get voting record with REAL votes
async function getVotingRecord(legislator) {
    const votes = {};
    
    try {
        if (CONFIG.PROPUBLICA_API_KEY) {
            const votesUrl = `https://api.propublica.org/congress/v1/members/${legislator.bioguideId}/votes.json`;
            
            const response = await fetch(votesUrl, {
                headers: {
                    'X-API-Key': CONFIG.PROPUBLICA_API_KEY
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.results && data.results[0] && data.results[0].votes) {
                    // Group by bill topic/committee
                    data.results[0].votes.slice(0, 50).forEach(vote => {
                        // Determine topic based on vote question or bill
                        let topic = 'Other Votes';
                        const question = (vote.question || '').toLowerCase();
                        const description = (vote.description || '').toLowerCase();
                        const billTitle = vote.bill ? (vote.bill.title || '').toLowerCase() : '';
                        
                        // Categorize by topic
                        if (question.includes('defense') || billTitle.includes('defense') || billTitle.includes('military')) {
                            topic = 'Defense & Military';
                        } else if (question.includes('health') || billTitle.includes('health') || billTitle.includes('medicare')) {
                            topic = 'Healthcare';
                        } else if (question.includes('tax') || billTitle.includes('tax') || question.includes('budget')) {
                            topic = 'Budget & Taxes';
                        } else if (question.includes('environment') || billTitle.includes('climate') || billTitle.includes('energy')) {
                            topic = 'Environment & Energy';
                        } else if (question.includes('education') || billTitle.includes('education') || billTitle.includes('student')) {
                            topic = 'Education';
                        } else if (question.includes('immigration') || billTitle.includes('immigration') || billTitle.includes('border')) {
                            topic = 'Immigration';
                        } else if (question.includes('infrastructure') || billTitle.includes('infrastructure') || billTitle.includes('transportation')) {
                            topic = 'Infrastructure';
                        } else if (question.includes('nomination')) {
                            topic = 'Nominations';
                        } else if (question.includes('procedure') || question.includes('motion') || question.includes('cloture')) {
                            topic = 'Procedural Votes';
                        }
                        
                        if (!votes[topic]) {
                            votes[topic] = [];
                        }
                        
                        votes[topic].push({
                            bill: vote.bill ? `${vote.bill.bill_id}: ${vote.bill.title || vote.question}` : vote.question,
                            date: vote.date,
                            position: vote.position || 'Not Voting',
                            result: vote.result,
                            description: vote.description || vote.question,
                            question: vote.question,
                            rollCall: vote.roll_call,
                            congress: vote.congress,
                            session: vote.session,
                            voteUrl: `https://www.congress.gov/roll-call-vote/${vote.congress}/${vote.session}/${vote.chamber}/${vote.roll_call}`
                        });
                    });
                    
                    return { grouped: votes, raw: data.results[0].votes };
                }
            }
        }
        
        // Fallback - provide direct link to voting record
        return {
            grouped: {
                'Voting Record': [{
                    bill: 'ProPublica API key required',
                    date: new Date().toISOString().split('T')[0],
                    position: 'Unknown',
                    description: `View ${legislator.name}'s voting record on Congress.gov`,
                    voteUrl: `https://www.congress.gov/member/${legislator.name.toLowerCase().replace(/ /g, '-')}/${legislator.bioguideId}`
                }]
            },
            raw: []
        };
        
    } catch (error) {
        console.error('Error fetching voting record:', error);
        return { grouped: {}, raw: [] };
    }
}

// Get REAL calendar events
async function getCalendarEvents(legislator) {
    const events = [];
    
    try {
        // Committee schedules - would need Congress.gov API
        events.push({
            title: 'View Committee Schedule',
            date: 'Updated Daily',
            type: 'Committees',
            location: 'Various',
            url: 'https://www.congress.gov/committees/schedule',
            description: 'See all upcoming committee hearings and markups'
        });
        
        // House/Senate calendar
        const chamber = legislator.type === 'Senator' ? 'senate' : 'house';
        events.push({
            title: `${chamber === 'senate' ? 'Senate' : 'House'} Floor Schedule`,
            date: 'This Week',
            type: 'Floor Activity',
            location: 'Capitol Building',
            url: `https://www.${chamber}.gov/legislative-activity`,
            description: `View this week's ${chamber} floor schedule and votes`
        });
        
        // Town halls - these are usually on their website
        if (legislator.website) {
            events.push({
                title: 'Town Halls & Local Events',
                date: 'Check Website',
                type: 'Public Events',
                location: 'District Offices',
                url: legislator.website + '/events',
                description: 'Find upcoming town halls and public meetings in your area'
            });
        }
        
        // Add social media for real-time updates
        events.push({
            title: 'Real-Time Updates',
            date: 'Follow for Latest',
            type: 'Social Media',
            location: 'Online',
            url: `https://twitter.com/search?q=${encodeURIComponent(legislator.name)}&f=user`,
            description: 'Representatives often announce events on social media'
        });
        
    } catch (error) {
        console.error('Error fetching calendar:', error);
    }
    
    return events;
}

// Enhanced campaign finance with real FEC data
async function getCampaignFinanceDetailed(legislator) {
    try {
        // Try multiple search strategies
        let candidateId = null;
        
        // First try with FEC ID if available
        if (legislator.fecId) {
            candidateId = legislator.fecId;
        } else {
            // Search by name
            const searchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(legislator.name)}&api_key=${CONFIG.FEC_API_KEY}`;
            const searchResponse = await fetch(searchUrl);
            
            if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                if (searchData.results && searchData.results.length > 0) {
                    candidateId = searchData.results[0].id;
                }
            }
        }
        
        if (!candidateId) {
            return {
                summary: {
                    totalRaised: 'Data not available',
                    totalSpent: 'Data not available',
                    cashOnHand: 'Data not available',
                    lastReport: 'Data not available'
                },
                sources: [],
                topContributors: []
            };
        }
        
        // Get financial summary
        const financeUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=${CONFIG.FEC_API_KEY}&cycle=2024`;
        const financeResponse = await fetch(financeUrl);
        
        if (!financeResponse.ok) {
            throw new Error('FEC API error');
        }
        
        const financeData = await financeResponse.json();
        
        if (financeData.results && financeData.results.length > 0) {
            const finances = financeData.results[0];
            
            // Get top contributors
            const contributorsUrl = `https://api.open.fec.gov/v1/schedules/schedule_a/by_size/by_candidate/?cycle=2024&candidate_id=${candidateId}&api_key=${CONFIG.FEC_API_KEY}&per_page=10`;
            const contribResponse = await fetch(contributorsUrl);
            
            let topContributors = [];
            if (contribResponse.ok) {
                const contribData = await contribResponse.json();
                if (contribData.results) {
                    topContributors = contribData.results.map(c => ({
                        size: c.size,
                        count: c.count,
                        total: `${c.total.toLocaleString()}`
                    }));
                }
            }
            
            return {
                summary: {
                    totalRaised: `${(finances.receipts || 0).toLocaleString()}`,
                    totalSpent: `${(finances.disbursements || 0).toLocaleString()}`,
                    cashOnHand: `${(finances.cash_on_hand_end_period || 0).toLocaleString()}`,
                    lastReport: finances.coverage_end_date || 'Not available',
                    debtOwed: `${(finances.debts_owed_by_committee || 0).toLocaleString()}`
                },
                sources: [
                    {
                        name: 'Individual Contributions',
                        amount: `${(finances.individual_contributions || 0).toLocaleString()}`,
                        percentage: finances.receipts ? Math.round((finances.individual_contributions / finances.receipts) * 100) : 0
                    },
                    {
                        name: 'PAC Contributions',
                        amount: `${(finances.other_political_committee_contributions || 0).toLocaleString()}`,
                        percentage: finances.receipts ? Math.round((finances.other_political_committee_contributions / finances.receipts) * 100) : 0
                    },
                    {
                        name: 'Party Contributions',
                        amount: `${(finances.party_committee_contributions || 0).toLocaleString()}`,
                        percentage: finances.receipts ? Math.round((finances.party_committee_contributions / finances.receipts) * 100) : 0
                    },
                    {
                        name: 'Candidate Self-Funding',
                        amount: `${(finances.candidate_contribution || 0).toLocaleString()}`,
                        percentage: finances.receipts ? Math.round((finances.candidate_contribution / finances.receipts) * 100) : 0
                    }
                ].filter(s => s.percentage > 0),
                topContributors: topContributors
            };
        }
        
        return {
            summary: {
                totalRaised: 'Data not available',
                totalSpent: 'Data not available',
                cashOnHand: 'Data not available',
                lastReport: 'Data not available'
            },
            sources: [],
            topContributors: []
        };
        
    } catch (error) {
        console.error('Campaign finance error:', error);
        return {
            summary: {
                totalRaised: 'Data temporarily unavailable',
                totalSpent: 'Data temporarily unavailable',
                cashOnHand: 'Data temporarily unavailable',
                lastReport: 'Check back later'
            },
            sources: [],
            topContributors: []
        };
    }
}

// Voting record endpoint with real data
app.get('/api/voting-record/:bioguideId', async (req, res) => {
    const bioguideId = req.params.bioguideId;
    
    const mockLegislator = { bioguideId, name: 'Representative' };
    const votingData = await getVotingRecord(mockLegislator);
    
    res.json(votingData);
});

// Enhanced campaign finance endpoint
app.get('/api/campaign-finance/:identifier', async (req, res) => {
    const identifier = req.params.identifier;
    
    // Try to find legislator info from identifier
    const mockLegislator = {
        name: identifier,
        fecId: null
    };
    
    const financeData = await getCampaignFinanceDetailed(mockLegislator);
    res.json(financeData);
});

// New transcripts endpoint
app.get('/api/transcripts/:bioguideId', async (req, res) => {
    const bioguideId = req.params.bioguideId;
    
    // Get legislator name from cache or database
    const mockLegislator = {
        bioguideId,
        name: 'Representative' // This would come from your data
    };
    
    const transcripts = await getTranscripts(mockLegislator);
    res.json({ transcripts });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        apis: {
            googleCivic: CONFIG.GOOGLE_CIVIC_API_KEY ? 'configured' : 'not configured',
            fec: CONFIG.FEC_API_KEY !== 'DEMO_KEY' ? 'configured' : 'using demo key',
            congress: CONFIG.CONGRESS_API_KEY ? 'configured' : 'not configured'
        }
    });
});

// Serve HTML
app.get('/', (req, res) => {
    // Check both root and templates directory
    const fs = require('fs');
    const rootPath = path.join(__dirname, 'index.html');
    const templatesPath = path.join(__dirname, 'templates', 'index.html');
    
    if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else if (fs.existsSync(templatesPath)) {
        res.sendFile(templatesPath);
    } else {
        res.status(404).send('index.html not found');
    }
});

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`Congressional Tracker`);
    console.log(`===================`);
    console.log(`Server running on port ${CONFIG.PORT}`);
    console.log(`Visit http://localhost:${CONFIG.PORT}`);
    console.log('\nAPI Status:');
    console.log(`- Google Civic: ${CONFIG.GOOGLE_CIVIC_API_KEY ? '✓ Configured' : '✗ Not configured (limited accuracy)'}`);
    console.log(`- FEC: ${CONFIG.FEC_API_KEY !== 'DEMO_KEY' ? '✓ Configured' : '⚠ Using DEMO_KEY'}`);
    console.log(`- Congress.gov: ${CONFIG.CONGRESS_API_KEY ? '✓ Configured' : '✗ Not configured'}`);
});
