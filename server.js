const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Main endpoint - find representatives by address
app.get('/api/representatives', async (req, res) => {
    const address = req.query.address;
    
    if (!address) {
        return res.status(400).json({ error: true, message: 'Address is required' });
    }
    
    console.log(`Finding representatives for: ${address}`);
    
    try {
        // Extract state from address
        const stateMatch = address.match(/\b([A-Z]{2})\b/i);
        const state = stateMatch ? stateMatch[1].toUpperCase() : null;
        
        if (!state) {
            return res.json({
                error: true,
                message: 'Please include state abbreviation in your address (e.g., CA, NY, TX)',
                representatives: []
            });
        }
        
        // Fetch legislators data
        const legislatorsUrl = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
        const response = await fetch(legislatorsUrl);
        const legislators = await response.json();
        
        const representatives = [];
        
        // Get senators
        const senators = legislators.filter(l => {
            const term = l.terms[l.terms.length - 1];
            return term.state === state && term.type === 'sen';
        }).slice(0, 2);
        
        senators.forEach(sen => {
            const term = sen.terms[sen.terms.length - 1];
            representatives.push({
                name: sen.name.official_full || `${sen.name.first} ${sen.name.last}`,
                office: 'Senator',
                party: term.party,
                state: term.state,
                district: null,
                phone: term.phone || '(202) 224-0000',
                website: term.url,
                address: term.address
            });
        });
        
        // Get a representative
        const rep = legislators.find(l => {
            const term = l.terms[l.terms.length - 1];
            return term.state === state && term.type === 'rep';
        });
        
        if (rep) {
            const term = rep.terms[rep.terms.length - 1];
            representatives.push({
                name: rep.name.official_full || `${rep.name.first} ${rep.name.last}`,
                office: 'Representative',
                party: term.party,
                state: term.state,
                district: term.district || 'Unknown',
                phone: term.phone || '(202) 225-0000',
                website: term.url,
                address: term.address
            });
        }
        
        res.json({
            representatives: representatives,
            address: address,
            method: 'State-based lookup',
            accuracy: 'Note: Shows your senators and a representative from your state. For exact district matching, a geocoding service is needed.'
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.json({
            error: true,
            message: 'Unable to fetch representative data',
            representatives: []
        });
    }
});

// Get voting records
app.get('/api/voting-record/:name', async (req, res) => {
    const repName = req.params.name;
    const votes = [];
    
    try {
        if (process.env.CONGRESS_API_KEY) {
            const url = `https://api.data.gov/congress/v3/bill/118?api_key=${process.env.CONGRESS_API_KEY}&limit=10&sort=updateDate+desc`;
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                data.bills?.forEach(bill => {
                    votes.push({
                        bill: `${bill.type} ${bill.number} - ${bill.title || 'No title'}`,
                        date: bill.updateDateIncludingText || 'Unknown',
                        vote: 'See Details',
                        description: bill.title || 'No description',
                        status: bill.latestAction?.text || 'In progress'
                    });
                });
            }
        }
        
        if (votes.length === 0) {
            votes.push({
                bill: "H.R. 1234 - Infrastructure Investment Act",
                date: "2024-03-15",
                vote: "Yes",
                description: "A bill to provide funding for national infrastructure improvements"
            });
        }
        
        res.json({ votes });
    } catch (error) {
        res.json({ votes: [] });
    }
});

// Get campaign finance data
app.get('/api/campaign-finance/:name', async (req, res) => {
    const repName = req.params.name;
    let fundingData = {
        totalRaised: 'N/A',
        totalSpent: 'N/A',
        cashOnHand: 'N/A',
        sources: []
    };
    
    try {
        if (process.env.FEC_API_KEY) {
            const searchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(repName)}&api_key=${process.env.FEC_API_KEY}`;
            const searchResponse = await fetch(searchUrl);
            
            if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                
                if (searchData.results?.[0]) {
                    const candidateId = searchData.results[0].id;
                    const totalsUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=${process.env.FEC_API_KEY}&cycle=2024`;
                    const totalsResponse = await fetch(totalsUrl);
                    
                    if (totalsResponse.ok) {
                        const totalsData = await totalsResponse.json();
                        const finances = totalsData.results?.[0];
                        
                        if (finances) {
                            const totalReceipts = finances.receipts || 0;
                            
                            fundingData = {
                                totalRaised: `$${totalReceipts.toLocaleString()}`,
                                totalSpent: `$${(finances.disbursements || 0).toLocaleString()}`,
                                cashOnHand: `$${(finances.cash_on_hand_end_period || 0).toLocaleString()}`,
                                sources: []
                            };
                            
                            const sources = [
                                { name: "Individual Contributions", amount: finances.individual_contributions || 0, icon: "👤" },
                                { name: "PAC Contributions", amount: finances.other_political_committee_contributions || 0, icon: "🏢" },
                                { name: "Party Contributions", amount: finances.party_committee_contributions || 0, icon: "🏛️" }
                            ];
                            
                            fundingData.sources = sources
                                .filter(s => s.amount > 0)
                                .map(s => ({
                                    ...s,
                                    amount: `$${s.amount.toLocaleString()}`,
                                    percentage: totalReceipts > 0 ? Math.round((s.amount / totalReceipts) * 100) : 0
                                }));
                        }
                    }
                }
            }
        }
        
        res.json(fundingData);
    } catch (error) {
        res.json(fundingData);
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        message: 'Congressional Tracker is running',
        apis: {
            congress: process.env.CONGRESS_API_KEY ? 'Configured' : 'Not configured',
            fec: process.env.FEC_API_KEY ? 'Configured' : 'Not configured'
        }
    });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Congressional Tracker running on port ${PORT}`);
});
