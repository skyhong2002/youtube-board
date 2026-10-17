/** 2026 county/city head candidates as approved by the Central Election Commission on 2026-10-16; mirrored in MayorReport.php. */
export const CANDIDATE_LIST_VERSION = '2026-10-16';
export const cities: Record<string, {
    label: string;
    candidates: Record<string, string>;
}> = {
    "taipei": {
        "label": "台北市",
        "candidates": {
            "蔣萬安": "blue",
            "沈伯洋": "green",
            "郭璽": "other",
            "蕭文乾": "other",
            "唐新民": "other",
            "林志成": "other"
        }
    },
    "newtaipei": {
        "label": "新北市",
        "candidates": {
            "李四川": "blue",
            "蘇巧慧": "green",
            "蘇輝湟": "other"
        }
    },
    "taoyuan": {
        "label": "桃園市",
        "candidates": {
            "張善政": "blue",
            "黃世杰": "green"
        }
    },
    "taichung": {
        "label": "台中市",
        "candidates": {
            "江啟臣": "blue",
            "何欣純": "green",
            "洪麗華": "other"
        }
    },
    "tainan": {
        "label": "台南市",
        "candidates": {
            "謝龍介": "blue",
            "陳亭妃": "green",
            "蕭燐洪": "other",
            "葉人文": "other"
        }
    },
    "kaohsiung": {
        "label": "高雄市",
        "candidates": {
            "柯志恩": "blue",
            "賴瑞隆": "green",
            "張靜": "other",
            "王肇民": "other",
            "洪方隆": "other"
        }
    },
    "keelung": {
        "label": "基隆市",
        "candidates": {
            "謝國樑": "blue",
            "童子瑋": "green",
            "魏造文": "other"
        }
    },
    "hsinchu": {
        "label": "新竹市",
        "candidates": {
            "高虹安": "other",
            "莊競程": "green",
            "何志勇": "other"
        }
    },
    "hsinchucounty": {
        "label": "新竹縣",
        "candidates": {
            "徐欣瑩": "blue",
            "鄭朝方": "green",
            "朱定瑀": "other"
        }
    },
    "miaoli": {
        "label": "苗栗縣",
        "candidates": {
            "鍾東錦": "blue",
            "陳品安": "green"
        }
    },
    "changhua": {
        "label": "彰化縣",
        "candidates": {
            "魏平政": "blue",
            "陳素月": "green",
            "陳重嘉": "other",
            "邱建富": "other"
        }
    },
    "nantou": {
        "label": "南投縣",
        "candidates": {
            "許淑華": "blue",
            "温世政": "green"
        }
    },
    "yunlin": {
        "label": "雲林縣",
        "candidates": {
            "張嘉郡": "blue",
            "劉建國": "green",
            "吳炳輝": "other",
            "林佳瑜": "other"
        }
    },
    "chiayi": {
        "label": "嘉義縣",
        "candidates": {
            "蔡易餘": "green",
            "吳品叡": "other"
        }
    },
    "chiayicity": {
        "label": "嘉義市",
        "candidates": {
            "張啓楷": "white",
            "王美惠": "green",
            "黃宏成台灣阿成世界偉人財神總統": "other",
            "陳愷璜": "other",
            "王義成": "other"
        }
    },
    "pingtung": {
        "label": "屏東縣",
        "candidates": {
            "周春米": "green",
            "蘇清泉": "blue"
        }
    },
    "yilan": {
        "label": "宜蘭縣",
        "candidates": {
            "吳宗憲": "blue",
            "林國漳": "green",
            "陳宏毅": "other",
            "劉燦輝": "other",
            "楊鉯婷": "other"
        }
    },
    "hualien": {
        "label": "花蓮縣",
        "candidates": {
            "游淑貞": "blue",
            "張峻": "other",
            "魏嘉賢": "other",
            "羅佩秦": "other"
        }
    },
    "taitung": {
        "label": "台東縣",
        "candidates": {
            "吳秀華": "blue",
            "陳瑩": "green",
            "李吳穎智": "other",
            "王志偉": "other"
        }
    },
    "penghu": {
        "label": "澎湖縣",
        "candidates": {
            "陳振中": "blue",
            "吳淑瑾": "green",
            "周倪安": "other",
            "許智富": "other",
            "陳盡川": "other",
            "葉竹林": "other"
        }
    },
    "kinmen": {
        "label": "金門縣",
        "candidates": {
            "陳玉珍": "blue",
            "李文良": "other",
            "洪和成": "other",
            "黃世團": "other",
            "張國威": "other",
            "梁文韜": "other",
            "張火木": "other"
        }
    },
    "lienchiang": {
        "label": "連江縣",
        "candidates": {
            "王忠銘": "blue",
            "曹爾元": "other"
        }
    }
};
/** Press spellings counted under the registered name; e.g. CEC registers 温世政 while many titles write 溫世政. */
export const candidateAliases: Record<string, string[]> = {"温世政": ["溫世政"]};
