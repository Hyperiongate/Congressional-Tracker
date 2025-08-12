# Congressional Tracker

Track your congressional representative's voting record, campaign funding, and public activities.

## 🚀 Quick Start Deployment

### Step 1: Save the Files

Create a new folder called `congressional-tracker` and save these files:
- `index.html` - The web interface
- `server.js` - The backend server
- `package.json` - Node.js configuration
- `.gitignore` - Git ignore file

### Step 2: Deploy to Render (Recommended - FREE)

1. **Create a GitHub Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Push to GitHub**
   - Create a new repository on GitHub
   - Follow GitHub's instructions to push your code

3. **Deploy on Render**
   - Go to [render.com](https://render.com)
   - Sign up/login
   - Click "New +" → "Web Service"
   - Connect your GitHub account
   - Select your repository
   - Use these settings:
     - **Name**: congressional-tracker
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
   - Click "Create Web Service"

Your app will be live in 2-3 minutes!

### Alternative: Deploy to Heroku

1. Install Heroku CLI
2. Run:
   ```bash
   heroku create your-app-name
   git push heroku main
   ```

### Alternative: Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Click "Start a New Project"
3. Select "Deploy from GitHub repo"
4. Select your repository
5. Click "Deploy Now"

## 🔧 Local Development

1. Install Node.js from [nodejs.org](https://nodejs.org)
2. Run these commands:
   ```bash
   npm install
   npm start
   ```
3. Open http://localhost:3000

## 📋 Current Features

✅ Find representatives by ZIP code
✅ View campaign funding data (real FEC data)
✅ Sample voting records
✅ Sample calendar events
✅ Mobile-responsive design

## 🚧 Coming Soon

- [ ] Real voting records from Congress.gov API
- [ ] Accurate ZIP to district mapping
- [ ] Town hall calendar integration
- [ ] Email notifications
- [ ] Historical voting analysis

## 🔑 API Keys (Optional)

The app works without API keys! But for better data:

1. **Congress.gov API**: [Apply here](https://api.congress.gov/sign-up/)
2. **Google Civic API**: [Get key here](https://console.cloud.google.com/)

Add to Render's environment variables when you get them.

## 🐛 Troubleshooting

**"Cannot find representative"**
- The demo uses limited ZIP code mapping
- Try ZIPs starting with: 10, 20, 30, 60, 90, 94

**"Funding data not loading"**
- FEC API has rate limits with DEMO_KEY
- Will work better with real representatives

## 📝 License

MIT License - Use freely!

## 🤝 Contributing

Pull requests welcome! Please check existing issues first.

---

Built with ❤️ for government transparency
