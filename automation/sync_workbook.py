"""Mirror the shared workbook to the rental CRM without writing source data to the repository."""
import base64
import collections
import datetime as dt
import hashlib
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import openpyxl

MAX_FILE = 18 * 1024 * 1024
MAX_UNPACKED = 180 * 1024 * 1024

def request(url, body=None, headers=None, limit=MAX_FILE):
    req = urllib.request.Request(url, data=body, headers=headers or {})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                raw = response.read(limit + 1)
            if len(raw) > limit:
                raise ValueError("File exceeded the size limit")
            return raw
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            code = getattr(exc, "code", None)
            if (code is not None and code < 500 and code != 429) or attempt == 2:
                raise RuntimeError(f"Remote request failed ({code or 'connection'})") from None
            time.sleep(2 ** attempt)

def read_source(file_id):
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,180}", file_id):
        raise ValueError("Invalid source identifier")
    # Drive serves the original Office file. Google-native sheets use the XLSX export.
    for url in (f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t",
                f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=xlsx"):
        try:
            raw = request(url)
        except RuntimeError:
            continue
        if zipfile.is_zipfile(io.BytesIO(raw)):
            with zipfile.ZipFile(io.BytesIO(raw)) as book:
                if sum(part.file_size for part in book.infolist()) > MAX_UNPACKED:
                    raise ValueError("Unpacked workbook exceeds the size limit")
                if "xl/workbook.xml" in book.namelist() and book.testzip() is None:
                    return raw
    raise ValueError("The source did not return a complete XLSX workbook")

def value(x):
    if isinstance(x, (dt.datetime,dt.date,dt.time)):
        return x.isoformat()
    if isinstance(x, dt.timedelta):
        return str(x)
    if isinstance(x, float):
        if not math.isfinite(x):return str(x)
        return int(x) if x.is_integer() else x
    if x is None or isinstance(x,(bool,str,int)):return x
    return str(x)

def text(x):
    return "" if x is None else str(value(x)).strip()

def amount(x):
    if isinstance(x, bool) or x is None:return None
    try:
        number=float(str(x).replace("\xa0","").replace(" ","").replace(",","."))
        return round(number,2) if math.isfinite(number) and 0<=number<1e10 else None
    except ValueError:return None

def price_items(ws):
    headers={text(c.value).casefold().rstrip(". "):c.column for c in ws[1] if c.value is not None}
    needed=["название","№ инв","s/n","цена аренды","залог","оценочная стоимость"]
    if any(h not in headers for h in needed):
        raise ValueError("Catalog headers changed. Last valid import is retained.")
    def cell(r,h):
        return ws.cell(r,headers[h]) if h in headers else None
    def val(r,h):
        c=cell(r,h);return c.value if c else None
    current="Без категории";items=[]
    for row in range(2,ws.max_row+1):
        raw_name=val(row,"название")
        if isinstance(raw_name,bool):
            continue
        name=text(raw_name)
        first=text(ws.cell(row,1).value)
        if not name:
            if first:current=first
            continue
        data={"name":name,"category":current,"inventory_no":text(val(row,"№ инв")),
              "serial_no":text(val(row,"s/n")),"rental_price":amount(val(row,"цена аренды")),
              "deposit":amount(val(row,"залог")),"estimated_value":amount(val(row,"оценочная стоимость")),
              "description":text(val(row,"используется")),"service_note":text(val(row,"обслуживание")),
              "note":text(val(row,"примечание"))}
        vid=cell(row,"видео")
        if vid and vid.hyperlink and vid.hyperlink.target:data["video_url"]=vid.hyperlink.target
        present=val(row,"есть")
        if isinstance(present,bool):data["status"]="available" if present else "repair"
        items.append({"line":row,"fields":data})
    return items

def parse(raw):
    wb=openpyxl.load_workbook(io.BytesIO(raw),data_only=False)
    cached=openpyxl.load_workbook(io.BytesIO(raw),data_only=True)
    sheets=[]
    for ws in wb.worksheets:
        cells=collections.defaultdict(dict)
        for c in ws._cells.values():
            if c.value is None and not c.comment and not c.hyperlink:continue
            datum={"v":value(c.value)}
            if c.data_type=="f":
                datum["f"]=c.value if isinstance(c.value,str) else getattr(c.value,"text","")
                datum["v"]=value(cached[ws.title].cell(c.row,c.column).value)
            if isinstance(c.value,(dt.date,dt.datetime,dt.time)) or (c.data_type=="f" and c.is_date):datum["date"]=True
            if c.hyperlink:
                datum["link"]=c.hyperlink.target or ("#"+(c.hyperlink.location or ""))
            if c.comment:
                datum["note"]=c.comment.text;datum["by"]=c.comment.author or ""
            cells[c.row][c.column]=datum
        rows=[[r,cols] for r,cols in sorted(cells.items())]
        sheets.append({"name":ws.title,"visibility":ws.sheet_state,"rows":rows,
                       "cells":sum(len(c) for c in cells.values()),"columns":max((max(c) for c in cells.values()),default=0)})
    price=next((ws for ws in cached.worksheets if ws.title.strip().casefold()=="прайс"),None)
    products=price_items(price) if price is not None else []
    return sheets,products

def sync():
    origin=os.environ["CRM_SUPABASE_URL"].rstrip("/")
    if not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co",origin):raise ValueError("Invalid database URL")
    key=os.environ["CRM_SYNC_SECRET"]
    def rpc(name,args):
        result=request(origin+"/rest/v1/rpc/"+name,json.dumps({"access_key":key,**args},ensure_ascii=False,allow_nan=False).encode(),
                       {"apikey":os.environ["CRM_PUBLIC_KEY"],"Content-Type":"application/json"},12000)
        return json.loads(result)
    raw=read_source(os.environ["GOOGLE_WORKBOOK_ID"])
    digest=hashlib.sha256(raw).hexdigest()
    state=rpc("kk_sheet_check",{"file_hash":digest})
    if state["same"]:
        print("Workbook unchanged; last successful check recorded.");return
    sheets,products=parse(raw)
    result=rpc("kk_sheet_import",{"expected_hash":state["previous"],"file_hash":digest,"archive":base64.b64encode(raw).decode(),
                                  "sheets":sheets,"products":products})
    print("Workbook synchronized successfully.")

if __name__=="__main__":
    try:sync()
    except Exception as exc:
        print("Synchronization failed:",type(exc).__name__,str(exc) if isinstance(exc,(ValueError,RuntimeError)) else "check source or database",file=sys.stderr)
        sys.exit(1)

