#!/bin/bash

echo "🚀 Kahoot Quiz App Setup Script"
echo "================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your Supabase credentials before continuing."
    echo "Press any key to continue after updating .env..."
    read -n 1 -s
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Run migrations
echo "🗄️  Running database migrations..."
echo "Make sure your DATABASE_URL in .env is correct!"
npx prisma migrate deploy

# Seed database (optional)
echo ""
read -p "Do you want to seed the database with sample data? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🌱 Seeding database..."
    npm run seed:teams
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update the Supabase credentials in public/*.html files"
echo "2. Enable replication in Supabase for required tables"
echo "3. Deploy to Vercel using 'vercel' command"
echo "4. Set environment variables in Vercel dashboard"
echo ""
echo "📖 See DEPLOYMENT_CHECKLIST.md for detailed instructions"
