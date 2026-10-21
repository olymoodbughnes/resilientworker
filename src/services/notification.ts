export type EmailPayload = {
  to: string;
  subject: string;
};

// Track how often the simulated service is called
let requestCount = 0;

export async function sendEmail(
  payload: EmailPayload
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500));

  requestCount++;

  // Simulate a temporary outage on the first 3 requests (circuit breaker test)
  if (requestCount <= 3) {
    throw new Error("Email service temporarily unavailable");
  }

  console.log(
    `Email sent to ${payload.to}: ${payload.subject}`
  );
}
