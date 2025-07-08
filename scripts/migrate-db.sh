#!/bin/bash

# Database migration script for ASI MCP Gateway
# Executes the schema.sql file against the D1 database

echo "🔄 Running database migrations..."

# Execute the schema file
wrangler d1 execute MCP_DB --file=./src/db/schema.sql

if [ $? -eq 0 ]; then
    echo "✅ Database migration completed successfully!"
else
    echo "❌ Database migration failed!"
    exit 1
fi 