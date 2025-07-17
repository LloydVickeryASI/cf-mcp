#!/bin/bash

# Script to set up secrets for the preview environment
# Run this once to configure all secrets for the persistent preview environment

echo "Setting up secrets for the preview environment..."
echo "This script will prompt you to enter each secret value."
echo ""

# List of required secrets
SECRETS=(
  "MICROSOFT_CLIENT_ID"
  "MICROSOFT_CLIENT_SECRET"
  "MICROSOFT_TENANT_ID"
  "PANDADOC_CLIENT_ID"
  "PANDADOC_CLIENT_SECRET"
  "HUBSPOT_CLIENT_ID"
  "HUBSPOT_CLIENT_SECRET"
  "XERO_CLIENT_ID"
  "XERO_CLIENT_SECRET"
  "NETSUITE_CLIENT_ID"
  "NETSUITE_CLIENT_SECRET"
  "AUTOTASK_CLIENT_ID"
  "AUTOTASK_CLIENT_SECRET"
  "COOKIE_ENCRYPTION_KEY"
  "SENTRY_DSN"
  "SENTRY_SAMPLE_RATE"
  "AUTH_HEADER_SECRET"
  "OAUTH_ENABLED"
)

# Function to copy a secret from production to preview
copy_from_production() {
  local secret_name=$1
  echo ""
  echo "Setting $secret_name for preview environment..."
  echo "Enter the value for $secret_name (or press Enter to skip):"
  read -s secret_value
  
  if [ -n "$secret_value" ]; then
    echo "$secret_value" | npx wrangler secret put "$secret_name" --env preview
    echo "✓ $secret_name has been set"
  else
    echo "⚠ Skipped $secret_name"
  fi
}

# Option to copy all secrets from .dev.vars if it exists
if [ -f ".dev.vars" ]; then
  echo "Found .dev.vars file. Would you like to use values from it? (y/n)"
  read -r use_dev_vars
  
  if [[ "$use_dev_vars" =~ ^[Yy]$ ]]; then
    echo "Using values from .dev.vars..."
    
    # Parse .dev.vars and set each secret
    while IFS='=' read -r key value; do
      # Skip empty lines and comments
      [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
      
      # Remove quotes if present
      value="${value%\"}"
      value="${value#\"}"
      
      # Check if this key is in our secrets list
      if [[ " ${SECRETS[@]} " =~ " ${key} " ]]; then
        echo "Setting $key..."
        echo "$value" | npx wrangler secret put "$key" --env preview
        echo "✓ $key has been set"
      fi
    done < .dev.vars
    
    echo ""
    echo "✅ All secrets from .dev.vars have been set for the preview environment"
    exit 0
  fi
fi

# Manual entry for each secret
echo "Please enter the values for each secret:"

for secret in "${SECRETS[@]}"; do
  copy_from_production "$secret"
done

echo ""
echo "✅ Preview environment secrets setup complete!"
echo ""
echo "You can now deploy to the preview environment using:"
echo "  wrangler deploy --env preview"
echo ""
echo "Or let GitHub Actions deploy preview URLs for PRs automatically."