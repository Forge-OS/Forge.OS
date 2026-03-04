export const C = {
  bg:"#05070A", s1:"#0B1118", s2:"#101923", s3:"#16222F",
  border:"#213043", muted:"#32435A",
  accent:"#39DDB6", aLow:"#112C2A",
  text:"#EAF1F8", dim:"#8FA0B5",
  danger:"#FF5D7A", dLow:"#311520",
  warn:"#F7B267",  wLow:"#322515",
  ok:"#39DDB6",    oLow:"#112C2A",
  purple:"#8F7BFF",
  shadow:"0 4px 16px rgba(0,0,0,0.28), 0 1px 3px rgba(0,0,0,0.4)",
};

export const mono = { fontFamily:"'IBM Plex Mono','SFMono-Regular',Menlo,Monaco,monospace" };

/** 4pt spacing scale */
export const space = { 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32 } as const;

/** Border-radius scale: chip → small interactive elements, btn → buttons/inputs, card → panels */
export const r = { chip:6, btn:8, card:12, panel:14 } as const;

/** Type scale in px */
export const t = { xs:10, sm:11, md:13, lg:16, xl:20, "2xl":28, "3xl":36 } as const;
