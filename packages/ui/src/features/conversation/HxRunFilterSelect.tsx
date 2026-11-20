// HXBot v1.7.5（RTN-03、RTN-04）：运行历史按结果筛选：全部、成功、无更新、结果未核实、失败、跳过和错过。
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hxbot/ui";
import { createUniqueId } from "solid-js";
import { useText } from "../../text";
import { HX_RUN_FILTER_LABEL, HX_RUN_FILTERS, type HxRunFilter } from "./hx-run-notes";

export function HxRunFilterSelect(props: { value: HxRunFilter; onChange: (filter: HxRunFilter) => void }) {
  const { t } = useText();
  const labelId = createUniqueId();
  return (
    <div class="hx-routine-run-filter">
      <span id={labelId}>{t("routine.hx.history.filter.label")}</span>
      <Select<HxRunFilter>
        options={[...HX_RUN_FILTERS]}
        value={props.value}
        onChange={(filter) => {
          if (filter) props.onChange(filter);
        }}
        itemComponent={(item) => <SelectItem item={item.item}>{t(HX_RUN_FILTER_LABEL[item.item.rawValue])}</SelectItem>}
      >
        <SelectTrigger aria-labelledby={labelId}>
          <SelectValue<HxRunFilter>>{(state) => t(HX_RUN_FILTER_LABEL[state.selectedOption()])}</SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
    </div>
  );
}
