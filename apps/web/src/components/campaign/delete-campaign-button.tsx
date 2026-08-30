"use client";

import { Trash2 } from "lucide-react";

import { deleteCampaignAction } from "@/server/actions/campaigns";

import { Button } from "@/components/ui/button";

export function DeleteCampaignButton({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  return (
    <form
      action={deleteCampaignAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Delete “${campaignName}”? This permanently removes its matches, scores, proposals, and monitor data.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="campaignId" type="hidden" value={campaignId} />
      <Button variant="danger" type="submit">
        <Trash2 className="mr-2 size-4" aria-hidden="true" />
        Delete campaign
      </Button>
    </form>
  );
}
