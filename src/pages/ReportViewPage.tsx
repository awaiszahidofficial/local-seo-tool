import { useParams } from 'react-router-dom'
import { ReportDocument } from '../components/ReportDocument'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { LoadingState } from '../components/ui/Spinner'
import { useLoad } from '../hooks/useLoad'
import { getReport, isReportSnapshot } from '../lib/reportSnapshot'

export function ReportViewPage() {
  const { reportId } = useParams()
  const report = useLoad(reportId ?? null, () => getReport(reportId ?? ''))
  const row = report.value?.data ?? null
  const backTo = row ? `/reports?project=${row.project_id}` : '/reports'

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <ButtonLink to={backTo} variant="secondary">
          Back to reports
        </ButtonLink>
        {row && isReportSnapshot(row.snapshot) ? (
          <Button onClick={() => window.print()}>Print or save as PDF</Button>
        ) : null}
      </div>
      {report.loading && !report.value ? (
        <LoadingState label="Loading the report…" />
      ) : report.value?.error ? (
        <Alert variant="error" title="Could not load the report">
          {report.value.error}
        </Alert>
      ) : !row ? (
        <Alert variant="warning" title="Report not found">
          It may have been deleted, or it belongs to another account.
        </Alert>
      ) : !isReportSnapshot(row.snapshot) ? (
        <Alert variant="warning" title="This report cannot be shown">
          It was saved in a format this version of the app does not recognise.
        </Alert>
      ) : (
        <ReportDocument title={row.title} snapshot={row.snapshot} />
      )}
    </>
  )
}
