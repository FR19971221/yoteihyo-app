"""
東京0819予定表.xlsx データ抽出スクリプト
【解析ロジック】
- openpyxlを使用し、セルの罫線（枠線: top, bottom, left, right）情報を基準にして予定ブロックを判定・抽出。
- 抽出結果を縦持ちリレーショナルデータ構造（JSON）に変換して出力します。
"""

import openpyxl
from openpyxl.utils import get_column_letter
import json
import os
import re
from datetime import datetime, date

def has_border(cell):
    """セルに実線・罫線が存在するか判定"""
    if not cell or not cell.border:
        return False
    b = cell.border
    has_l = bool(b.left and b.left.style)
    has_r = bool(b.right and b.right.style)
    has_t = bool(b.top and b.top.style)
    has_b = bool(b.bottom and b.bottom.style)
    return has_l or has_r or has_t or has_b

def parse_members(text):
    """テキストからメンバーコード（M, R, Z, 吉, 黒 等）を抽出"""
    if not text:
        return []
    # 「M.R.Z.吉.黒」「M/R/吉」「M・R・黒」「M R 吉」等の区切り文字に対応
    cleaned = re.sub(r'[・\.\,\/\s　、]+', ' ', str(text)).strip()
    tokens = cleaned.split()
    return tokens

def extract_schedule(excel_path="東京0819予定表.xlsx", output_json="schedules.json"):
    if not os.path.exists(excel_path):
        print(f"警告: {excel_path} が見つかりません。")
        return []

    wb = openpyxl.load_workbook(excel_path, data_only=True)
    all_schedules = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        print(f"シート解析中: {sheet_name} (行: {ws.max_row}, 列: {ws.max_column})")

        # 結合セルの範囲辞書を作成
        merged_map = {}
        for m_range in ws.merged_cells.ranges:
            min_col, min_row, max_col, max_row = m_range.min_col, m_range.min_row, m_range.max_col, m_range.max_row
            top_left_cell = ws.cell(row=min_row, column=min_col)
            for r in range(min_row, max_row + 1):
                for c in range(min_col, max_col + 1):
                    merged_map[(r, c)] = {
                        "top_left": (min_row, min_col),
                        "val": top_left_cell.value,
                        "bounds": (min_row, min_col, max_row, max_col)
                    }

        # 1. 日付ヘッダー行の特定（8/19, 8月19日, 2026-08-19 などの日付パターン探索）
        date_columns = {} # col_idx -> date_string (YYYY-MM-DD)
        header_row_idx = None

        for r in range(1, min(15, ws.max_row + 1)):
            matched_dates = 0
            temp_dates = {}
            for c in range(1, ws.max_column + 1):
                val = ws.cell(row=r, column=c).value
                if isinstance(val, (datetime, date)):
                    temp_dates[c] = val.strftime("%Y-%m-%d")
                    matched_dates += 1
                elif isinstance(val, str):
                    # 8/19, 8月19日 などの判定
                    m = re.search(r'(\d{1,2})[\/\月](\d{1,2})', val)
                    if m:
                        month, day = int(m.group(1)), int(m.group(2))
                        # 年は現在年または2026年を仮定
                        current_year = 2026
                        d_str = f"{current_year}-{month:02d}-{day:02d}"
                        temp_dates[c] = d_str
                        matched_dates += 1
            if matched_dates >= 2:
                header_row_idx = r
                date_columns = temp_dates
                print(f"  日付ヘッダー行を検出: 行 {r} ({len(date_columns)} 日付カラム)")
                break

        # 日付が未検出の場合、デフォルトで列1〜7を日付スロットとして割り当て
        if not date_columns:
            for c in range(2, min(15, ws.max_column + 1)):
                date_columns[c] = f"2026-08-{18+c:02d}"

        # 2. ステータス行・領域の特定
        # 典型的なステータス分類
        status_keywords = ["現場", "社内勤務", "社内", "休み", "有休", "5階泊", "ﾎﾃﾙ泊", "ホテル泊", "宿泊", "移動", "未定"]

        current_status = "現場"
        visited_cells = set()

        start_row = (header_row_idx + 1) if header_row_idx else 2
        for r in range(start_row, ws.max_row + 1):
            # 行の先頭列にステータス文字列があるか確認
            col1_val = str(ws.cell(row=r, column=1).value or "").strip()
            for kw in status_keywords:
                if kw in col1_val:
                    current_status = kw
                    break

            for c in range(1, ws.max_column + 1):
                if (r, c) in visited_cells:
                    continue

                cell = ws.cell(row=r, column=c)
                val = cell.value
                is_bordered = has_border(cell)
                is_merged = (r, c) in merged_map

                # 罫線がある、または結合セルで枠線化されているブロックを抽出
                if is_bordered or (is_merged and val is not None):
                    # 結合セルの場合、該当範囲全体を訪問済みにする
                    item_text = ""
                    if is_merged:
                        m_info = merged_map[(r, c)]
                        min_r, min_c, max_r, max_c = m_info["bounds"]
                        for mr in range(min_r, max_r + 1):
                            for mc in range(min_c, max_c + 1):
                                visited_cells.add((mr, mc))
                        item_text = str(m_info["val"] or "").strip()
                        target_col = min_c
                    else:
                        visited_cells.add((r, c))
                        item_text = str(val or "").strip()
                        target_col = c

                    # 日付の特定（対象列から最寄りの日付カラムを参照）
                    target_date = date_columns.get(target_col)
                    if not target_date:
                        # 直前または直後の列から探す
                        for offset in range(-2, 3):
                            if (target_col + offset) in date_columns:
                                target_date = date_columns[target_col + offset]
                                break
                    if not target_date:
                        target_date = "2026-08-19"

                    # 罫線ブロック判定：テキストがあるか、または明示的な空枠線ブロック
                    members = []
                    title = item_text
                    details = ""

                    # 「M.R.Z.吉.黒」等のメンバー記号や案件名の分離
                    # 例: "【渋谷現場】 M.R.吉 (9:00〜)" や "黒 (社内作業)"
                    lines = item_text.split('\n')
                    if len(lines) >= 2:
                        title = lines[0].strip()
                        details = " ".join(lines[1:]).strip()
                        # 詳細行からメンバー抽出を試みる
                        members = parse_members(lines[1])
                    else:
                        # 括弧や区切りから抽出
                        member_match = re.search(r'([A-Za-z0-9吉黒佐藤田中鈴木M・R・Z\.\s]{2,})', item_text)
                        if member_match and any(code in item_text for code in ['M', 'R', 'Z', '吉', '黒']):
                            members = parse_members(member_match.group(1))

                    # ステータスの詳細判定（テキスト内に特定キーワードがあれば上書き）
                    item_status = current_status
                    for kw in status_keywords:
                        if kw in item_text:
                            item_status = kw
                            break

                    # 縦持ちアイテム作成
                    schedule_id = f"sch_{sheet_name}_{r}_{c}"
                    schedule_item = {
                        "id": schedule_id,
                        "sheet": sheet_name,
                        "row": r,
                        "col": c,
                        "date": target_date,
                        "status": item_status,
                        "title": title if title else "(予定枠)",
                        "details": details,
                        "members": members if members else [],
                        "hasBorder": is_bordered,
                        "isMerged": is_merged
                    }
                    all_schedules.append(schedule_item)

    print(f"\n合計 {len(all_schedules)} 件のスケジュールブロックを罫線・枠線基準で抽出しました。")
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(all_schedules, f, ensure_ascii=False, indent=2)
    print(f"抽出結果を {output_json} に保存しました。")
    return all_schedules

if __name__ == '__main__':
    extract_schedule()
