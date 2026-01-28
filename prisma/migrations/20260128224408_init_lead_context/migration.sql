-- CreateTable
CREATE TABLE "LeadContext" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "afp" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "fbclid" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "client_ip_address" TEXT,
    "client_user_agent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadContext_lead_id_key" ON "LeadContext"("lead_id");

-- CreateIndex
CREATE INDEX "LeadContext_afp_idx" ON "LeadContext"("afp");

-- CreateIndex
CREATE INDEX "LeadContext_createdAt_idx" ON "LeadContext"("createdAt");
