import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getPassengersList } from "@/lib/operations/passengers-list";
import { PageHeader } from "@/components/ui/PageHeader";
import { FilterBar } from "@/components/ui/FilterBar";
import { SearchInput } from "@/components/ui/SearchInput";
import { Button } from "@/components/ui/Button";
import { AddPassengerButton } from "@/components/operations/passengers/AddPassengerButton";
import { PassengersTable } from "@/components/operations/passengers/PassengersTable";

/**
 * The canonical Passenger directory (P1-E3-S8B1; real Edit/Deactivate
 * added P1-E3-S9 — closes GAP-12). Click a row to edit — the existing
 * narrow, safe `passengers` UPDATE grant (display_name/phone/
 * assistance_notes/status only) is exactly what `EditPassengerDialog`
 * uses. Assistance notes remain out of the DIRECTORY TABLE itself
 * (minimum-necessary display discipline, unchanged from P1-E3-S8B1) —
 * only the Edit dialog's own bounded, deliberate context shows/edits
 * them, the same principle Trip Detail's own panel already established.
 */
export default async function PassengersListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/passengers");
  const organization = await requireOperationsAccess(pathname);
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q : "";

  const result = await getPassengersList(organization.organizationId, search);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Passengers"
        description="The people whose transportation your team coordinates."
        actions={<AddPassengerButton />}
      />

      {/* NP-UI-P2: the shared FilterBar frame around the same GET search. */}
      <FilterBar
        search={
          <form method="get">
            <SearchInput name="q" label="Search passengers" placeholder="Search by name or phone" defaultValue={search} />
            <Button type="submit" className="sr-only">
              Search
            </Button>
          </form>
        }
        resultCount={`${result.totalCount} ${result.totalCount === 1 ? "passenger" : "passengers"}${search ? ` matching “${search}”` : ""}`}
      />

      <PassengersTable rows={result.rows} search={search} />
    </div>
  );
}
