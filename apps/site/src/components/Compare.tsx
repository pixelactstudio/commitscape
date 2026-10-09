import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Popover } from "@astryxdesign/core/Popover";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Swords } from "lucide-react";
import { isLogin } from "@commitscape/data";

/** Opens a Versus between this person and whoever is typed, or the viewer. */
export function Compare({ login }: { login: string }) {
  const navigate = useNavigate();
  const { user } = useRouteContext({ from: "__root__" });
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState("");
  const [wrong, setWrong] = useState(false);
  const go = (b: string) => {
    setOpen(false);
    void navigate({ to: "/vs/$a/$b", params: { a: login, b } });
  };
  const mine = user?.login && user.login.toLowerCase() !== login.toLowerCase() ? user.login : null;
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      label={`Compare @${login}`}
      placement="below"
      alignment="end"
      width={300}
      content={
        <form
          className="flex flex-col gap-3 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = other.trim().replace(/^@/, "");
            if (isLogin(name)) go(name);
            else setWrong(true);
          }}
        >
          <TextInput
            label={`@${login} versus`}
            placeholder="a GitHub username"
            value={other}
            onChange={(v) => {
              setOther(v);
              setWrong(false);
            }}
            hasAutoFocus
            status={wrong ? { type: "error", message: "That is not a GitHub username." } : undefined}
          />
          <div className="flex justify-between gap-2">
            {mine ? <Button label="Versus me" variant="ghost" size="sm" onClick={() => go(mine)} /> : <span />}
            <Button label="Compare" variant="primary" size="sm" type="submit" />
          </div>
        </form>
      }
    >
      <Button label="Compare" variant="secondary" icon={<Icon icon={Swords} size="sm" />} />
    </Popover>
  );
}
