import { useState } from "react";
import { Download, Printer, FileText } from "lucide-react";
import { Button, Overlay, Table, exportCSV, Select } from "./ui";
export function ReportButton({
  module,
  headers,
  rows,
}: {
  module: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("Visão atual");
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileText size={15} />
        <span className="hidden sm:inline">Relatório</span>
      </Button>
      {open && (
        <Overlay title={`Relatório de ${module.toLowerCase()}`} onClose={() => setOpen(false)}>
          <div className="print:hidden">
            <p className="mb-4 text-sm text-muted-foreground">
              Os dados respeitam a seleção e os filtros desta tela.
            </p>
            <Select
              label="Apresentação"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option>Visão atual</option>
              <option>Resumo executivo</option>
            </Select>
            <div className="my-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => exportCSV(`smilesync-${module.toLowerCase()}`, headers, rows)}
              >
                <Download size={16} />
                Exportar CSV
              </Button>
              <Button onClick={() => window.print()}>
                <Printer size={16} />
                Imprimir / PDF
              </Button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Para PDF, escolha “Salvar como PDF” na janela de impressão.
            </p>
          </div>
          <div className="print-report">
            <p className="mb-3 text-sm font-medium">
              SmileSync · {module} · {rows.length} registros
            </p>
            {format === "Visão atual" ? (
              <Table headers={headers}>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, column) => (
                      <td key={column}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </Table>
            ) : (
              <div className="space-y-3 text-sm">
                <p>
                  Total de registros: <strong>{rows.length}</strong>
                </p>
                {rows.map((row, index) => (
                  <p key={index} className="border-b border-border py-2">
                    {row.slice(0, 3).join(" · ")}
                  </p>
                ))}
              </div>
            )}
          </div>
        </Overlay>
      )}
    </>
  );
}
