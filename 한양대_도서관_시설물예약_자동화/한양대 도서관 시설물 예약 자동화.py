from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time

# 크롬 프로필 불러와서 로그인 상태 유지
chrome_options = Options() #옵션 저장
chrome_options.add_argument(r"--user-data-dir=C:\Users\SEUNGJUN\AppData\Local\Google\Chrome_Selenium")  # 내 PC의 chrome 경로에 맞게 경로 조정
chrome_options.add_argument("--profile-directory=Profile 1")  # 보통은 Default, 다른 프로필이면 바꿔야 함

driver = webdriver.Chrome(options=chrome_options)

from datetime import datetime

# 오늘 날짜를 'YYYY-MM-DD(weekday)' 형식으로 가져오기, 예약 날짜 지정
today = datetime.today().strftime('%Y-%m-%d')
weekday_kor = ['월', '화', '수', '목', '금', '토', '일']
weekday = weekday_kor[datetime.today().weekday()]
print(f"{today}({weekday})")

# 예약 날짜 지정
hope_date = input("YYYY-MM-DD형식으로 입력하세요.")
room_id = "91"
url = f"https://lib.hanyang.ac.kr/facility/room/all-rooms/{room_id}/{hope_date}?hopeDate={hope_date}"
driver.get(url)
time.sleep(2)  # 페이지 로딩 대기

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

lib_id = "sjunoh2004" #보안 마스킹!!!
lib_pw = "oeu1055^&^"

# 아이디 입력
id_input = driver.find_element(By.CSS_SELECTOR, 'input[formcontrolname="userId"]')
id_input.clear()
id_input.send_keys(lib_id)

# 비밀번호 입력
pw_input = driver.find_element(By.CSS_SELECTOR, 'input[formcontrolname="password"]')
pw_input.clear()
pw_input.send_keys(lib_pw)

# 로그인 버튼 활성화 대기 후 클릭
WebDriverWait(driver, 5).until(
    EC.element_to_be_clickable((By.XPATH, '//button[.//span[text()="로그인"]]'))
)
login_btn = driver.find_element(By.XPATH, '//button[.//span[text()="로그인"]]')
login_btn.click()

from selenium.webdriver.support.ui import Select

# 선택지 딕셔너리
choices = {1: "13:00", 2: "15:00"}

# 사용자에게 번호를 입력받음
num = int(input("예약 시작 시간을 선택하세요 (1: 13:00, 2: 15:00): "))

# 선택한 시간 가져오기
selected_time = choices[num]

# 예약시작시간 셀렉트 박스 요소 찾기
select_begin_elem = driver.find_element(By.CSS_SELECTOR, 'select[formcontrolname="beginTime"]')
select_begin_obj = Select(select_begin_elem)

# 드롭다운에서 시간 선택
try:
    select_begin_obj.select_by_value(selected_time)
except Exception as e:
    print("해당 옵션이 없습니다. 다른 시간대를 선택하세요.")

# 예약종료시간 셀렉트 박스 요소 찾기
select_end_elem = driver.find_element(By.CSS_SELECTOR, 'select[formcontrolname="endTime"]')
select_obj = Select(select_end_elem)

# 드롭다운에서 시간 선택
endtime_map = {"13:00": "15:00", "15:00": "17:00"}
selected_endtime = endtime_map.get(selected_time)
if selected_endtime:
    try:
        select_obj.select_by_value(selected_endtime)
    except Exception as e:
        print("해당 옵션이 없습니다. 다른 시간대를 선택하세요.")
else:
    print("매칭되는 종료 시간이 없습니다.")

# 이용목적 셀렉트 박스 요소 찾기
select_use_elem = driver.find_element(By.CSS_SELECTOR, 'select[formcontrolname="useSection"]')
select_obj = Select(select_use_elem)
select_obj.select_by_value("2") #회의

# 전체 명단: 이름을 key로, 학번을 value로 저장
all_members = {
    "김동현": "2016042606",
    "김재훈": "2017046353",
    "황찬우": "2018026299",
    "김민국": "2016044293",
    "박중현": "2019033454",
    "송원빈": "2017029043",
    "이우석": "2020076571",
    "이윤수": "2018025750",
    "이명빈": "2021048813"
}

selected_names = input(
    "동반 이용자 4명의 이름을 ,로 구분해서 입력: \n"
    "목록: 김동현, 김재훈, 황찬우, 김민국, 박중현, 송원빈, 이우석, 이윤수, 이명빈").split(",")
selected_names = [name.strip() for name in selected_names][:4]  # 앞뒤 공백 제거, 최대 4명

# 동반자 추가 아이콘 클릭 (처음 한 번만)
WebDriverWait(driver, 10).until(
    EC.element_to_be_clickable((By.CSS_SELECTOR, 'mat-icon[matSuffix]'))
).click()

for name in selected_names:
    if name not in all_members:
        print(f"{name} 정보 없음, 건너뜀.")
        continue
    memberNo = all_members[name]
    
    # 이름 입력
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, 'input[formcontrolname="name"]'))
    ).clear()
    driver.find_element(By.CSS_SELECTOR, 'input[formcontrolname="name"]').send_keys(name)
    
    # 학번 입력
    driver.find_element(By.CSS_SELECTOR, 'input[formcontrolname="memberNo"]').clear()
    driver.find_element(By.CSS_SELECTOR, 'input[formcontrolname="memberNo"]').send_keys(memberNo)
    
    # "추가" 버튼 클릭
    driver.find_element(By.XPATH, '//button[span[text()="추가"]]').click()
    time.sleep(2.5)  # 너무 빨리 다음 반복 돌지 않게

print("동반 이용자 4명 추가 완료!")


#한번 확인하고, 등록 클릭!

driver.find_element(By.XPATH, '//button[span[text()="등록"]]').click()

#동반이용자 개인정보수집동의 클릭 단 클릭이 가능해질때까지 대기.

try:
    WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.XPATH, '//label[contains(text(),"위 사항을 확인하고 동의합니다")]'))).click()
except:
    WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.XPATH, '//label[contains(text(),"위 사항을 확인하고 동의합니다")]'))).click()

# 마지막 신청버튼 클릭

driver.find_element(By.XPATH, '//button[.//span[text()="신청"]]').click()

driver.quit()
