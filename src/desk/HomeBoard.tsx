import { Button, Input, Select, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";
import { ImageField } from "./ImageField.tsx";
import { useTr } from "./language.tsx";

type MenuItem = { label: string; link_type: LinkType; href: string };

type LinkType = "page" | "blank" | "none";

type Banner = {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  action_label: string;
  link_type: LinkType;
  href: string;
  image_id: string | null;
  image_key: string | null;
  image_url: string | null;
};

type HomePage = {
  menu: MenuItem[];
  banners: Banner[];
};

const EMPTY_BANNER: Banner = { eyebrow: "", title: "", body: "", action_label: "", link_type: "page", href: "", image_id: null, image_key: null, image_url: null };

export function HomeBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draft = JSON.stringify({ menu, banners });
  const dirty = draft !== baseline;

  const failAuth = useCallback(
    (caught: ApiError) => {
      if (caught.status === 401) {
        props.onUnauthorized();
        return true;
      }
      if (caught.code === "mfa_setup_required") {
        props.onMfaSetup();
        return true;
      }
      return false;
    },
    [props.onUnauthorized, props.onMfaSetup],
  );

  const apply = useCallback((page: HomePage) => {
    const nextMenu = page.menu.map((item) => ({
      label: item.label,
      link_type: item.link_type ?? (looksExternal(item.href) ? "blank" : "page"),
      href: item.href,
    }));
    const nextBanners = page.banners.map((item) => ({
      id: item.id,
      eyebrow: item.eyebrow,
      title: item.title,
      body: item.body,
      action_label: item.action_label,
      link_type: item.link_type ?? "page",
      href: item.href,
      image_id: item.image_url ? item.id ?? null : null,
      image_key: null,
      image_url: item.image_url,
    }));
    setMenu(nextMenu);
    setBanners(nextBanners);
    setBaseline(JSON.stringify({ menu: nextMenu, banners: nextBanners }));
    setError(null);
  }, []);

  const load = useCallback(async () => {
    const page = await api<HomePage>("/api/v1/public/home");
    apply(page);
  }, [apply]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được trang chủ", "无法加载首页"), "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [failAuth, load]);

  function changeMenu(next: MenuItem[]) {
    setNotice(null);
    setMenu(next);
  }

  function changeBanners(next: Banner[]) {
    setNotice(null);
    setBanners(next);
  }

  function updateMenu(index: number, patch: Partial<MenuItem>) {
    setNotice(null);
    setMenu((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function updateBanner(index: number, patch: Partial<Banner>) {
    setNotice(null);
    setBanners((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const page = await api<HomePage>("/api/v1/admin/home", {
        method: "PUT",
        body: {
          menu: menu.map((item) => ({ label: item.label.trim(), link_type: item.link_type, href: item.link_type === "none" ? "" : item.href.trim() })),
          banners: banners.map((item) => ({
            eyebrow: item.eyebrow.trim(),
            title: item.title.trim(),
            body: item.body.trim(),
            action_label: item.action_label.trim(),
            link_type: item.link_type,
            href: item.link_type === "none" ? "" : item.href.trim(),
            image_id: item.image_key ? null : item.image_id,
            image_key: item.image_key,
          })),
        },
      });
      apply(page);
      setNotice(tr("Đã lưu menu và banner trang chủ.", "已保存首页菜单和横幅。"));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được trang chủ", "无法保存首页"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Trang chủ", "首页")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Menu và banner khuyến mãi hiện trên trang chủ chat. Thứ tự trong danh sách là thứ tự hiển thị.", "显示在聊天首页的菜单和促销横幅。列表中的顺序就是显示顺序。")}</Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
            {tr("Lưu", "保存")}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph>{notice}</Typography.Paragraph> : null}
      <div className="home-editor">
        <section>
          <header>
            <Typography.Title level={5}>{tr("Menu", "菜单")}</Typography.Title>
            {props.canWrite ? (
              <Button size="small" disabled={loading || menu.length >= 12} onClick={() => changeMenu([...menu, { label: "", link_type: "page", href: "/" }])}>
                {tr("Thêm mục", "添加项")}
              </Button>
            ) : null}
          </header>
          {menu.length === 0 ? <Typography.Text type="secondary">{tr("Chưa có mục menu.", "还没有菜单项。")}</Typography.Text> : null}
          {menu.length > 0 ? (
            <div className="home-row home-row--menu home-row--head">
              <span>{tr("Tên mục", "名称")}</span>
              <span>{tr("Kiểu chuyển hướng", "跳转方式")}</span>
              <span>{tr("Đường dẫn", "路径")}</span>
              <span />
            </div>
          ) : null}
          {menu.map((item, index) => (
            <article key={`menu-${index}`} className="home-row home-row--menu">
              <Input value={item.label} maxLength={40} placeholder={tr("Tên mục", "名称")} disabled={!props.canWrite || loading} onChange={(event) => updateMenu(index, { label: event.target.value })} />
              <LinkChoice
                lined
                linkType={item.link_type}
                href={item.href}
                disabled={!props.canWrite || loading}
                onChange={(next) => updateMenu(index, next)}
              />
              {props.canWrite ? (
                <div className="home-row__actions">
                  <Button size="small" disabled={index === 0} onClick={() => changeMenu(move(menu, index, -1))}>
                    {tr("Lên", "上移")}
                  </Button>
                  <Button size="small" disabled={index === menu.length - 1} onClick={() => changeMenu(move(menu, index, 1))}>
                    {tr("Xuống", "下移")}
                  </Button>
                  <Button size="small" danger onClick={() => changeMenu(menu.filter((_, itemIndex) => itemIndex !== index))}>
                    {tr("Xóa", "删除")}
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
        <section>
          <header>
            <Typography.Title level={5}>{tr("Banner khuyến mãi", "促销横幅")}</Typography.Title>
            {props.canWrite ? (
              <Button size="small" disabled={loading || banners.length >= 8} onClick={() => changeBanners([...banners, { ...EMPTY_BANNER }])}>
                {tr("Thêm banner", "添加横幅")}
              </Button>
            ) : null}
          </header>
          {banners.length === 0 ? <Typography.Text type="secondary">{tr("Chưa có banner.", "还没有横幅。")}</Typography.Text> : null}
          {banners.map((item, index) => (
            <article key={`banner-${index}`} className="home-row home-row--banner">
              <Input value={item.eyebrow} maxLength={40} placeholder={tr("Nhãn nhỏ", "小标签")} disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { eyebrow: event.target.value })} />
              <Input value={item.title} maxLength={120} placeholder={tr("Tiêu đề", "标题")} disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { title: event.target.value })} />
              <Input.TextArea value={item.body} maxLength={400} rows={2} placeholder={tr("Nội dung", "内容")} disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { body: event.target.value })} />
              <Input value={item.action_label} maxLength={40} placeholder={tr("Chữ trên nút", "按钮文字")} disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { action_label: event.target.value })} />
              <LinkChoice
                linkType={item.link_type}
                href={item.href}
                disabled={!props.canWrite || loading}
                onChange={(next) => updateBanner(index, next)}
              />
              <ImageField
                url={item.image_url ?? ""}
                disabled={!props.canWrite || loading}
                onChange={(next) => updateBanner(index, { image_id: null, image_key: next.key, image_url: next.url || null })}
                onError={(problem) => {
                  if (!failAuth(problem)) {
                    setError(problem);
                  }
                }}
              />
              {props.canWrite ? (
                <div className="home-row__actions">
                  <Button size="small" disabled={index === 0} onClick={() => changeBanners(move(banners, index, -1))}>
                    {tr("Lên", "上移")}
                  </Button>
                  <Button size="small" disabled={index === banners.length - 1} onClick={() => changeBanners(move(banners, index, 1))}>
                    {tr("Xuống", "下移")}
                  </Button>
                  <Button size="small" danger onClick={() => changeBanners(banners.filter((_, itemIndex) => itemIndex !== index))}>
                    {tr("Xóa", "删除")}
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function LinkChoice(props: { lined?: boolean; linkType: LinkType; href: string; disabled: boolean; onChange: (next: { link_type: LinkType; href: string }) => void }) {
  const tr = useTr();
  const options = [
    { value: "page" as const, label: tr("Trong trang", "站内打开") },
    { value: "blank" as const, label: tr("Link ngoài", "外部链接") },
    { value: "none" as const, label: tr("Không chuyển", "不跳转") },
  ];
  const select = (
    <Select
      value={props.linkType}
      options={options}
      disabled={props.disabled}
      onChange={(value: LinkType) => props.onChange({ link_type: value, href: value === "none" ? "" : props.href })}
    />
  );
  const path =
    props.linkType === "none" ? (
      <span />
    ) : (
      <Input
        value={props.href}
        maxLength={300}
        placeholder={props.linkType === "blank" ? "https://example.com" : "/khuyen-mai"}
        disabled={props.disabled}
        onChange={(event) => {
          const href = event.target.value;
          props.onChange({ link_type: props.linkType === "page" && looksExternal(href) ? "blank" : props.linkType, href });
        }}
      />
    );
  if (props.lined) {
    return (
      <>
        {select}
        {path}
      </>
    );
  }
  return (
    <>
      <div className="home-field">
        <span>{tr("Kiểu chuyển hướng", "跳转方式")}</span>
        {select}
      </div>
      {props.linkType === "none" ? null : (
        <div className="home-field">
          <span>{props.linkType === "blank" ? tr("Địa chỉ web", "网址") : tr("Đường dẫn trong trang", "站内路径")}</span>
          {path}
        </div>
      )}
    </>
  );
}

function looksExternal(value: string): boolean {
  const text = value.trim();
  return /^https?:\/\//i.test(text) || /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/?#]\S*)?$/.test(text);
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (next < 0 || next >= items.length) {
    return items;
  }
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  if (!item) {
    return items;
  }
  copy.splice(next, 0, item);
  return copy;
}
