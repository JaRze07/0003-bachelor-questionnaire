# Deploy commands (run from a machine with gcloud and firebase CLI)

Project: `jr07-0003-bachelor` (Google Cloud), region `europe-central2`.

```bash
# 1. API to Cloud Run (build from source, scale to zero, at most 2 instances)
gcloud run deploy bachelor-api \
  --project jr07-0003-bachelor --region europe-central2 \
  --source api --allow-unauthenticated \
  --min-instances 0 --max-instances 2 --cpu 1 --memory 512Mi --concurrency 40 \
  --set-env-vars "WEB_BASE=https://jr07-0003-bachelor.web.app,CORS_ORIGINS=https://jr07-0003-bachelor.web.app|capacitor://localhost|https://localhost,PLAY_PACKAGE_NAME=com.jr07.bachelorquestionnaire,INTERNAL_SA_EMAIL=bachelor-jobs@jr07-0003-bachelor.iam.gserviceaccount.com,INTERNAL_AUDIENCE=<service url>"

# 2. Web surfaces to Firebase Hosting (partner form, spectator page, host bundle)
firebase deploy --only hosting --project jr07-0003-bachelor

# 3. Retention job, daily at 04:00 Europe/Warsaw
gcloud scheduler jobs create http bachelor-retention \
  --project jr07-0003-bachelor --location europe-central2 --schedule "0 4 * * *" \
  --time-zone Europe/Warsaw --uri "<service url>/v1/internal/jobs/retention" --http-method POST \
  --oidc-service-account-email bachelor-jobs@jr07-0003-bachelor.iam.gserviceaccount.com \
  --oidc-token-audience "<service url>"

# 4. Play purchase notifications (after the Play Console exists)
gcloud pubsub topics create play-rtdn --project jr07-0003-bachelor
gcloud pubsub subscriptions create play-rtdn-push --project jr07-0003-bachelor --topic play-rtdn \
  --push-endpoint "<service url>/v1/internal/play/rtdn" \
  --push-auth-service-account bachelor-jobs@jr07-0003-bachelor.iam.gserviceaccount.com
```

Firebase Authentication: enable the Google provider (and Apple when iOS ships) in the console.
Firestore: native mode, region europe-central2, default database.
Never commit keys: the Android keystore lives in GitHub Actions secrets, nothing else is needed.
