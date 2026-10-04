import { leadersOf, WINDOW_VIEWS, type WindowStandings } from "@commitscape/data";
import { Face } from "@commitscape/ui";

/** People in a window, a column a view, the leaders of each marked; never one winner. */
export function WindowTable({ standings }: { standings: WindowStandings }) {
  const leaders = leadersOf(standings.rows);
  const rows = [...standings.rows].sort((a, b) => b.prsMerged - a.prsMerged || b.contributions - a.contributions);
  return (
    <div className="standings-wrap">
      <table className="standings">
        <thead>
          <tr>
            <th>Person</th>
            {WINDOW_VIEWS.map((v) => (
              <th key={v.id} className="num">
                {v.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.login}>
              <td>
                <span className="name">
                  <Face login={r.login} name={r.name ?? r.login} size={24} />
                  <a href={`/u/${r.login}`}>{r.name ?? r.login}</a>
                </span>
              </td>
              {WINDOW_VIEWS.map((v) => (
                <td key={v.id} className={leaders[v.id].includes(r.login) ? "num versus-win versus-right-cell" : "num"}>
                  {r[v.id].toLocaleString("en-US")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
